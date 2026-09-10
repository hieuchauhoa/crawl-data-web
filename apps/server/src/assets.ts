import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import https from "node:https";
import http from "node:http";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import type { AssetDownloadResult, AssetKind, UrlRewriteRule } from "@crawl/shared";

// Operator-defined "replace this bit with that" rules (see UrlRewriteEditor in the web UI), applied in
// order before any candidate URL is downloaded — every occurrence, not just the first, since a thumb
// path segment can legitimately repeat (e.g. inside a query string mirroring the path).
export function applyUrlRewrite(url: string, rules: UrlRewriteRule[] | null | undefined): string {
  if (!rules || !rules.length) return url;
  return rules.reduce((u, r) => r.find ? u.split(r.find).join(r.replace) : u, url);
}

const MIME_EXT: Record<string,string> = {
  "image/jpeg": "jpg", "image/pjpeg": "jpg", "image/png": "png", "image/gif": "gif",
  "image/webp": "webp", "image/avif": "avif", "image/svg+xml": "svg", "image/bmp": "bmp", "image/x-icon": "ico"
};
function extFromMime(mime: string | null): string | null {
  if (!mime) return null;
  return MIME_EXT[mime.split(";")[0]!.trim().toLowerCase()] || null;
}
function extFromUrl(url: string): string | null {
  try { const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i); return m ? m[1]!.toLowerCase() : null; } catch { return null; }
}
// The URL's own extension (or lack of one, e.g. `/image.php?id=5`) is never trusted for the stored
// file's extension — only the real bytes are. Header content-type is checked first, then magic bytes.
function sniffMime(buf: Buffer): string | null {
  if (buf.length >= 3 && buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) return "image/jpeg";
  if (buf.length >= 8 && buf.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return "image/png";
  if (buf.length >= 6 && ["GIF87a", "GIF89a"].includes(buf.subarray(0, 6).toString("ascii"))) return "image/gif";
  if (buf.length >= 12 && buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  const head = buf.subarray(0, 256).toString("utf8").trimStart();
  if (head.startsWith("<?xml") || head.startsWith("<svg")) return "image/svg+xml";
  return null;
}

// Some source-site image CDNs turn out to have a genuinely broken/expired TLS certificate (observed
// in the wild: a cert that expired back in 2010, on an otherwise perfectly reachable, real CDN host) —
// real-world server misconfiguration, not anything about this tool or the operator's machine. Node
// correctly refuses that connection by default, same as any browser would. Retried, once, without
// certificate validation ONLY here — downloading a public image asset the operator already knows is
// coming from this exact URL — never for page navigation or any other request this tool makes.
function isCertError(e: unknown): boolean {
  const err = e as { cause?: { code?: string; message?: string }; code?: string; message?: string };
  const text = `${err?.cause?.code || err?.code || ""} ${err?.cause?.message || err?.message || ""}`;
  return /CERT|certificate|SSL routines|TLS/i.test(text);
}
function fetchInsecure(url: string, referer: string | undefined): Promise<{ buf: Buffer; headerMime: string | null }> {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https:") ? https : http;
    const req = mod.get(url, {
      rejectUnauthorized: false,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CrawlDataWeb/1.0)", ...(referer ? { Referer: referer } : {}) },
      timeout: 20000
    }, res => {
      if (!res.statusCode || res.statusCode >= 400) { res.resume(); reject(new Error(`HTTP ${res.statusCode}`)); return; }
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () => resolve({ buf: Buffer.concat(chunks), headerMime: res.headers["content-type"]?.split(";")[0]?.trim().toLowerCase() || null }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

// Node's built-in fetch (undici) only understands http(s) — it has no file: scheme support at all, so
// every asset URL on a locally-mirrored offline site (crawled via file://) failed outright with a bare
// "fetch failed". Reading the bytes straight off disk for a file: URL sidesteps that entirely; a real
// http(s) URL still goes through fetch exactly as before, headers included.
async function fetchBytes(url: string, referer: string | undefined): Promise<{ buf: Buffer; headerMime: string | null }> {
  if (url.startsWith("file:")) return { buf: await fs.readFile(fileURLToPath(url)), headerMime: null };
  try {
    const resp = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CrawlDataWeb/1.0)", ...(referer ? { Referer: referer } : {}) },
      signal: AbortSignal.timeout(20000)
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    return { buf: Buffer.from(await resp.arrayBuffer()), headerMime: resp.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || null };
  } catch (e) {
    if (!isCertError(e)) throw e;
    return fetchInsecure(url, referer);
  }
}

// Many CMS/gallery libraries serve resized/watermarked copies through a path-based resize proxy
// (e.g. "/thumbs/400x400x1/upload/x.jpg", "/watermark/600x750x1/upload/x.jpg") with the untouched
// original sitting at the same path minus that segment ("/upload/x.jpg") — charter §24's "cho phép
// rule /thumbs/100x100x1/ -> / nhưng không hardcode". Generic across sites: it strips any
// thumbs/watermark/resize/crop/cache segment shaped like "{word}/{W}x{H}[x{N}]/", not one hardcoded
// pattern, and only ever offers it as a candidate to *try* — never assumed to exist.
function deriveOriginalCandidates(url: string): string[] {
  try {
    const u = new URL(url);
    const stripped = u.pathname.replace(/\/(?:thumbs?|watermark|resize|resized|crop|cache)\/\d+x\d+(?:x\d+)?\//gi, "/");
    if (stripped === u.pathname) return [];
    const orig = new URL(u.toString());
    orig.pathname = stripped;
    return [orig.toString()];
  } catch { return []; }
}

export class AssetStore {
  private log: AssetDownloadResult[] = [];
  constructor(private storeDir: string) {}
  async init() { await fs.mkdir(this.storeDir, { recursive: true }); }
  getLog() { return this.log; }

  // Tries any derived "original" candidates first (one attempt each — these are speculative path
  // guesses), then falls back to the URL actually found on the page with the full retry budget.
  async downloadOne(url: string, kind: AssetKind, referer?: string): Promise<AssetDownloadResult> {
    for (const candidate of deriveOriginalCandidates(url)) {
      const r = await this.attemptDownload(candidate, kind, referer, 1);
      if (r.status !== "error") return r;
    }
    return this.attemptDownload(url, kind, referer, 3);
  }

  private async attemptDownload(url: string, kind: AssetKind, referer: string | undefined, maxAttempts: number): Promise<AssetDownloadResult> {
    let lastError: string | null = null;
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        const { buf, headerMime } = await fetchBytes(url, referer);
        if (!buf.length) throw new Error("Response rỗng");
        const mime = (headerMime && headerMime.startsWith("image/") ? headerMime : null) || sniffMime(buf);
        if (!mime) throw new Error("Không xác định được đây là ảnh (content-type/byte signature không khớp image/*)");
        const ext = extFromMime(mime) || extFromUrl(url) || "bin";
        const sha256 = createHash("sha256").update(buf).digest("hex");
        const storedPath = path.join(this.storeDir, `${sha256}.${ext}`);
        const reused = fssync.existsSync(storedPath);
        if (!reused) await fs.writeFile(storedPath, buf);
        let width: number | null = null, height: number | null = null;
        try { const dim = imageSize(buf); width = dim.width; height = dim.height; } catch {}
        const result: AssetDownloadResult = { sourceUrl: url, kind, status: reused ? "reused" : "downloaded", sha256, ext, mime, width, height, bytes: buf.length, exportName: null, error: null };
        this.log.push(result);
        return result;
      } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
    }
    const result: AssetDownloadResult = { sourceUrl: url, kind, status: "error", sha256: null, ext: null, mime: null, width: null, height: null, bytes: null, exportName: null, error: lastError };
    this.log.push(result);
    return result;
  }

  // Candidates are tried in priority order (largest declared/likely-best first); the first that
  // downloads successfully wins, so a broken "best guess" URL falls back instead of failing the item.
  async downloadBestOf(candidates: string[], kind: AssetKind, referer?: string): Promise<AssetDownloadResult | null> {
    let last: AssetDownloadResult | null = null;
    for (const url of candidates) {
      const r = await this.downloadOne(url, kind, referer);
      if (r.status !== "error") return r;
      last = r;
    }
    return last;
  }

  storedPathFor(result: AssetDownloadResult): string | null {
    if (!result.sha256 || !result.ext) return null;
    return path.join(this.storeDir, `${result.sha256}.${result.ext}`);
  }

  // Copies the deduped store object out into the flat, human-named export folder (charter §27/§28).
  async exportFlat(result: AssetDownloadResult, exportName: string, exportDir: string) {
    if (result.status === "error" || !result.sha256 || !result.ext) return;
    const src = path.join(this.storeDir, `${result.sha256}.${result.ext}`);
    const dest = path.join(exportDir, exportName);
    if (!fssync.existsSync(dest)) { await fs.mkdir(exportDir, { recursive: true }); await fs.copyFile(src, dest); }
  }
}

// Flat, collision-safe export filename: slug + asset type + short content hash (charter §27).
export function assetExportName(slug: string, kind: AssetKind, sha256: string, ext: string, index?: number): string {
  const safeSlug = (slug || "item").toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "item";
  const shortHash = sha256.slice(0, 8);
  const suffix = index != null ? `-${String(index + 1).padStart(2, "0")}` : "";
  return `${safeSlug}-${kind}${suffix}-${shortHash}.${ext}`;
}
