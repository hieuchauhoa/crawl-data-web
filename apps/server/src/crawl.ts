import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { chromium, type Browser, type Page } from "playwright";
import type { CrawlRecipe, CrawlRun, CrawlRuntimeState, CrawlQueueItem, RecipeField, SelectorStrategy, SeoData } from "@crawl/shared";
import { phase3Dir } from "./config.js";

const statePath = path.join(phase3Dir, "crawl-state.json");
let runtime: CrawlRuntimeState = { activeRunId: null, runs: [] };
let browser: Browser | null = null;
let abortRequested = new Set<string>();
let activePromises = new Map<string, Promise<void>>();

// Adaptive backoff: no proxies, so the only lever against a site's own rate-limiting/anti-bot defenses
// is *when* to request next. All workers on a run share one gate rather than each backing off
// independently — a shared gate reacts to the run's overall error rate (what the target site actually
// sees) instead of N workers each timing their own retries and still hammering the site in aggregate.
// A normal 404 does not trip this — only responses that look like active throttling/blocking do, so a
// site with a few broken links doesn't slow down a run that's otherwise going fine.
type Throttle = { consecutiveErrors: number; backoffUntil: number };
const throttles = new Map<string, Throttle>();
function getThrottle(runId: string): Throttle {
  let t = throttles.get(runId);
  if (!t) { t = { consecutiveErrors: 0, backoffUntil: 0 }; throttles.set(runId, t); }
  return t;
}
function isBlockLike(httpStatus: number | null, errorMessage: string): boolean {
  if (httpStatus === 403 || httpStatus === 429 || httpStatus === 503) return true;
  return /timeout|ECONNRESET|ECONNREFUSED|net::ERR/i.test(errorMessage);
}
async function respectThrottle(runId: string) {
  const wait = getThrottle(runId).backoffUntil - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
}
// Returns the backoff seconds just applied, or null if this outcome didn't change anything (so the
// caller only logs when there's actually something new to tell the operator).
function recordOutcome(runId: string, ok: boolean, httpStatus: number | null, errorMessage: string): number | null {
  const t = getThrottle(runId);
  if (ok) { t.consecutiveErrors = 0; return null; }
  if (!isBlockLike(httpStatus, errorMessage)) return null;
  t.consecutiveErrors++;
  if (t.consecutiveErrors < 3) return null;
  const seconds = Math.min(60, 2 * 2 ** Math.min(t.consecutiveErrors - 3, 5)) + Math.random() * 2;
  t.backoffUntil = Date.now() + seconds * 1000;
  return Math.round(seconds);
}
// Shared by discover() (list pages) and worker() (detail pages): a 403/429/503/timeout is not treated
// as "this is the end of the pagination" or "this URL is broken" — it's retried a few times through the
// shared backoff gate first, since on a blocked run every subsequent request would otherwise look like
// the same false signal. A genuine 404 or other non-block error is NOT retried here; the caller (which
// knows whether "page N doesn't exist" or "this item is gone" is a normal stop condition) decides what
// to do with a resolved-but-bad response.
async function gotoWithBackoff(p:Page, url:string, run:CrawlRun, stage:"list"|"detail", workerId:number|null=null) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await respectThrottle(run.id);
    let resp: Awaited<ReturnType<Page["goto"]>> = null; let errMsg = "";
    try { resp = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }); }
    catch (e) { errMsg = e instanceof Error ? e.message : String(e); }
    const status = resp?.status() ?? null;
    const ok = !!resp && status! < 400;
    const backoffSec = recordOutcome(run.id, ok, status, errMsg);
    if (!ok && isBlockLike(status, errMsg) && attempt < 3) {
      log(run, stage, `Bị chặn/lỗi mạng (HTTP ${status ?? "timeout"}) — thử lại sau ${backoffSec ?? 3}s`, url, workerId);
      await new Promise(r => setTimeout(r, (backoffSec ?? 3) * 1000));
      continue;
    }
    if (!resp && errMsg) throw new Error(errMsg);
    return resp;
  }
  return null;
}

export async function initCrawlRuntime() { await fs.mkdir(phase3Dir,{recursive:true}); try { runtime = JSON.parse(await fs.readFile(statePath,"utf8")); } catch {} for (const r of runtime.runs) {
  if (["running","discovering"].includes(r.status)) r.status="paused";
  // A queue item stuck at "running" means a worker's in-flight goto/extract never got to write its
  // final status before the process died — this can happen no matter what the *run's* own status
  // currently is (e.g. it died mid-request just as an explicit pause had already flipped the run to
  // "paused"). Reset unconditionally, not just when the run itself looks like it was mid-crawl —
  // otherwise these items are invisible to both crash recovery and Resume forever (Resume only ever
  // picks up "pending" items), so the run silently never finishes.
  for (const q of r.queue) if (q.status==="running") { q.status="pending"; q.startedAt=null; }
} await persist(); }
async function persist(){ await fs.writeFile(statePath,JSON.stringify(runtime,null,2),"utf8"); }
export function getCrawlRuntime(){ return runtime; }
function log(run:CrawlRun, stage:"run"|"list"|"detail", message:string, url:string|null=null, worker:number|null=null, error?:unknown){ run.logs.push({at:new Date().toISOString(),runId:run.id,url,stage,worker,level:error?"error":"info",message,...(error?{error:error instanceof Error?error.message:String(error)}:{})}); run.logs=run.logs.slice(-1000); }
function canonicalize(raw:string, base?:string){ const u=new URL(raw,base); u.hash=""; ["utm_source","utm_medium","utm_campaign","utm_term","utm_content","fbclid","gclid"].forEach(k=>u.searchParams.delete(k)); u.pathname=u.pathname!=="/"?u.pathname.replace(/\/+$/,""):"/"; for (const k of [...u.searchParams.keys()]) if (k.startsWith("utm_")) u.searchParams.delete(k); return u.toString(); }
// Tolerate selectors saved before the Extension stopped baking in runtime-toggled state classes
// (e.g. a lazy-load library's "loaded"/"loading" class, only present after the browser has actually
// scrolled the element into view) — see content.ts's VOLATILE_CLASS filter for the root-cause fix on
// newly-picked selectors. The lookahead requires the class name not be followed by a word/hyphen
// char, so e.g. ".error-message" is left alone — only a whole ".error" class segment is stripped.
const VOLATILE_CLASS_RE = /\.(?:loaded|loading|lazyloaded|lazyload|active|hovered?|selected|open|closed|visible|hidden|error|disabled|checked|focused?|current|in-view|is-visible|is-active|is-loaded)(?![\w-])/gi;
function selector(s:SelectorStrategy|null){
  const raw = s?.primary || s?.fallback?.[0] || null;
  if (!raw) return null;
  const stripped = raw.replace(VOLATILE_CLASS_RE, "").trim();
  return stripped || raw;
}
function inferredPattern(recipe:CrawlRecipe){ const p=recipe.list.pagination; if(p.kind!=="none" || !p.page2Url) return null; try { const a=new URL(recipe.source.startUrl), b=new URL(p.page2Url,a); for(const [k,v] of b.searchParams){ if(a.searchParams.get(k)!==v && /^\d+$/.test(v)){ const t=new URL(b); t.searchParams.set(k,"{page}"); return t.toString().replace("%7Bpage%7D","{page}"); } } const ma=a.pathname.match(/(\d+)(?!.*\d)/), mb=b.pathname.match(/(\d+)(?!.*\d)/); if(mb && (!ma || ma[1]!==mb[1])) return b.toString().replace(mb[1]!,"{page}"); } catch {} return null; }
function pageUrl(recipe:CrawlRecipe,n:number){ const p=recipe.list.pagination; const raw=p.kind==="url-pattern"?p.pattern:inferredPattern(recipe); if(!raw) return n===1?recipe.source.startUrl:null; if(n===1) return recipe.source.startUrl;
  // Tolerate recipes saved before the Extension's %7Bpage%7D encoding bug was fixed (see content.ts
  // inferPagination): normalize the percent-encoded placeholder here too, so already-saved recipes
  // paginate correctly without the user having to redo the pagination step.
  const pattern=raw.replace(/%7Bpage%7D/gi,"{page}");
  return pattern.includes("{page}")?new URL(pattern.replace("{page}",String(n)),recipe.source.startUrl).toString():null; }
// Missing optional selectors (canonical/twitter/robots/etc. are frequently absent) must fail fast:
// without an explicit timeout, Playwright's default 30s actionability wait applies per-lookup and
// a page missing several of these would stall a single detail crawl for minutes.
const OPTIONAL_LOOKUP_TIMEOUT = 3000;
async function firstAttr(page:Page, query:string, attribute:string){
  try { return await page.locator(query).first().getAttribute(attribute, { timeout: OPTIONAL_LOOKUP_TIMEOUT }); } catch { return null; }
}
// Every lookup below is independent (different selector, no shared mutable state), so they're fired
// concurrently via Promise.all instead of one `await` at a time. With a sequential await chain, a page
// missing N optional tags pays N × OPTIONAL_LOOKUP_TIMEOUT; run concurrently, a whole item pays that
// timeout at most once (the slowest single lookup), not once per missing tag — this was the main cause
// of full crawls feeling like they'd stalled on real sites with several absent optional SEO tags.
async function seo(page:Page):Promise<SeoData>{
  const jsonLdPromise = page.locator('script[type="application/ld+json"]').allTextContents().catch(() => [] as string[]);
  const [title, description, keywords, canonical, ogTitle, ogDescription, ogImage, ogUrl, twitterTitle, twitterDescription, twitterImage, robots, jsonLd] = await Promise.all([
    page.title().catch(() => ""),
    firstAttr(page,'meta[name="description"]','content'),
    firstAttr(page,'meta[name="keywords"]','content'),
    firstAttr(page,'link[rel="canonical"]','href'),
    firstAttr(page,'meta[property="og:title"]','content'),
    firstAttr(page,'meta[property="og:description"]','content'),
    firstAttr(page,'meta[property="og:image"]','content'),
    firstAttr(page,'meta[property="og:url"]','content'),
    firstAttr(page,'meta[name="twitter:title"]','content'),
    firstAttr(page,'meta[name="twitter:description"]','content'),
    firstAttr(page,'meta[name="twitter:image"]','content'),
    firstAttr(page,'meta[name="robots"]','content'),
    jsonLdPromise
  ]);
  return {
    title: title || null, description, keywords, canonical, ogTitle, ogDescription, ogImage, ogUrl,
    twitterTitle, twitterDescription, twitterImage, robots,
    jsonLd: jsonLd.flatMap(text=>{ try { return [JSON.parse(text)]; } catch { return []; } })
  };
}
async function extractBreadcrumb(page:Page, recipe:CrawlRecipe){
  const levels = recipe.list.breadcrumb.filter(l => !l.ignored && selector(l.selector));
  const texts = await Promise.all(levels.map(l => page.locator(selector(l.selector)!).first().textContent({ timeout: OPTIONAL_LOOKUP_TIMEOUT }).catch(() => null)));
  return levels.map((l, i) => ({ index: l.index, text: texts[i]?.trim() || "" })).filter(b => b.text);
}
// Best-effort image candidate resolution (src/srcset/data-src/data-original/parent-link), capped to
// a handful so a missing/broken gallery or avatar selector never balloons download work.
// evaluateAll callbacks are serialized and re-run inside the browser page. Keep them to a single
// chained return expression with no local const/let/nested-function declarations: under esbuild's
// dev transform (tsx watch), a multi-statement callback can get wrapped with a `__name(...)` helper
// call that Playwright ships into the page — which throws "ReferenceError: __name is not defined"
// there, since that helper only exists in the Node bundle. See PATCH_NOTES_PHASE3_EVALUATE_FIX.md
// for the first time this bit the SEO extractor; extractGallery/discover's avatar pass hit it again.
async function extractGallery(page:Page, recipe:CrawlRecipe): Promise<string[]> {
  const sel = selector(recipe.detail.gallery);
  if (!sel) return [];
  try {
    const raw = await page.locator(sel).evaluateAll(els => els.map(e =>
      (e.tagName === "IMG" ? e.getAttribute("src") || e.getAttribute("data-src") || e.getAttribute("data-original")
        : e.querySelector("img")?.getAttribute("src") || e.querySelector("img")?.getAttribute("data-src"))
      || (e.tagName === "A" ? e.getAttribute("href") : e.querySelector("a[href]")?.getAttribute("href"))
      || null
    ).filter((u): u is string => !!u));
    const base = page.url();
    const abs = raw.map(u => { try { return new URL(u, base).href; } catch { return null; } }).filter((u): u is string => !!u);
    return [...new Set(abs)].slice(0, 20);
  } catch { return []; }
}
// For data with no single wrapping element to select at all — only bounded by "starts after this
// sibling, ends at that one" (see RangeSelector / content.ts's range-start/range-end picker modes).
// Uses the native DOM Range API in the browser, exactly like the picker's own client-side preview
// (rangeHtmlPreview in content.ts), so what was previewed while building the Recipe is what a real
// crawl produces. The two landmarks do NOT need to be siblings or even at the same nesting depth —
// Range captures everything strictly between them in document order regardless of structure, which is
// required for content whose real closing landmark is nested inside an earlier, shallower wrapper.
// Single-expression arrow body, no nested function/class declarations — Playwright serializes this and
// re-runs it inside the page with none of esbuild's dev-mode helpers available, which a nested named
// helper here has broken before (see other page.evaluate calls in this file).
async function extractRange(page: Page, range: { start: SelectorStrategy; end: SelectorStrategy }): Promise<string | null> {
  const startSel = selector(range.start), endSel = selector(range.end);
  if (!startSel || !endSel) return null;
  try {
    // Typed loosely on purpose: this server package's tsconfig has no "dom" lib (it's Node code), so
    // `document`/`Element` aren't ambient types here even though they're real globals once this
    // function body is serialized and run inside the browser page by Playwright.
    return await page.evaluate(
      ({ s, e }: { s: string; e: string }) => {
        const doc = (globalThis as any).document;
        const startEl = doc.querySelector(s);
        const endEl = doc.querySelector(e);
        if (!startEl || !endEl || startEl === endEl) return null;
        // The two selectors are landmarks picked for how reliably they repeat across pages, not
        // themselves part of the data — only what's strictly between them is (see content.ts's matching
        // rangeHtmlPreview, which the operator saw as a live preview while picking these two elements).
        const r = doc.createRange();
        r.setStartAfter(startEl);
        r.setEndBefore(endEl);
        const div = doc.createElement("div");
        div.appendChild(r.cloneContents());
        return div.innerHTML;
      },
      { s: startSel, e: endSel }
    );
  } catch { return null; }
}
async function extractField(page:Page, f:RecipeField): Promise<string|null> {
  if (f.extraction === "range") return f.rangeSelector ? extractRange(page, f.rangeSelector) : null;
  if (f.source!=="dom" || !f.selector) return f.sampleValue ?? null;
  const sel = selector(f.selector); if (!sel) return null;
  const loc = page.locator(sel).first();
  try {
    if (f.extraction==="html") return await loc.innerHTML({ timeout: OPTIONAL_LOOKUP_TIMEOUT });
    if (f.extraction==="attribute" && f.attribute) {
      const raw = await loc.getAttribute(f.attribute, { timeout: OPTIONAL_LOOKUP_TIMEOUT });
      // A raw href is frequently relative ("/san-pham/abc.html") — meaningless once written into a
      // database column with no page to resolve it against. The picker itself already stores an
      // absolute sample for this same reason (see content.ts); the crawler has to match that at
      // extraction time too, or every item after the first would silently save a broken relative link.
      if (raw && f.attribute === "href") { try { return new URL(raw, page.url()).href; } catch { return raw; } }
      return raw;
    }
    return (await loc.textContent({ timeout: OPTIONAL_LOOKUP_TIMEOUT }))?.trim() || null;
  } catch { return null; }
}
async function extractDetail(page:Page, recipe:CrawlRecipe){
  // "Read more" / "show full content" toggles (e.g. a site that only populates the real article body
  // into the DOM once clicked) are clicked once, sequentially, *before* the concurrent field reads
  // below — not per-field inside extractField — so two fields sharing the same toggle don't race each
  // other, and a field's own read never runs before the click it depends on has actually settled.
  const clickSelectors = [...new Set(recipe.detail.fields.map(f => f.clickBeforeExtract ? selector(f.clickBeforeExtract) : null).filter((s): s is string => !!s))];
  // force:true bypasses Playwright's "is anything else on top of this element" actionability check —
  // "read more" toggles are frequently placed under a CSS fade/gradient overlay (used to visually
  // clip the truncated text), which a real click would land on fine but Playwright's stricter check
  // treats as blocking. We only need the element's JS click handler to fire, not to simulate a
  // pixel-accurate mouse click, so forcing past that check is the right call here.
  for (const sel of clickSelectors) { try { await page.locator(sel).first().click({ timeout: OPTIONAL_LOOKUP_TIMEOUT, force: true }); } catch {} }
  if (clickSelectors.length) await page.waitForTimeout(400);
  const [fieldValues, seoData, breadcrumb, galleryCandidates] = await Promise.all([
    Promise.all(recipe.detail.fields.map(f => extractField(page, f))),
    seo(page),
    extractBreadcrumb(page, recipe),
    extractGallery(page, recipe)
  ]);
  const fields:Record<string,string|null>={};
  recipe.detail.fields.forEach((f, i) => { fields[`${f.targetTable}.${f.targetColumn}`] = fieldValues[i]!; });
  return { fields, seo: seoData, breadcrumb, galleryCandidates };
}
async function discover(run:CrawlRun, recipe:CrawlRecipe){ run.status="discovering"; await persist(); const b=browser ||= await chromium.launch({headless:true}); const p=await b.newPage(); try { const inferred=inferredPattern(recipe);
    // detectedMax is only ever a guess from whichever page-number links happened to be clickable in the
    // pagination cluster at pick time — the site's CURRENT page number is frequently rendered as plain
    // text rather than a real <a href> (a very common pagination pattern), so picking the cluster from
    // page N under-counts by however many pages aren't the first. Real stopping already happens below
    // from the page's actual content (empty page, HTTP error, or an identical item set to the page
    // before) — detectedMax is never trustworthy enough to use as a hard ceiling on top of that.
    const max=recipe.list.pagination.kind==="url-pattern"?100:(inferred?100:1); let previousSet=""; for(let n=1;n<=max;n++){ if(abortRequested.has(run.id)) return; const url=pageUrl(recipe,n); if(!url) break; log(run,"list",`Discover page ${n}`,url);
      // Probing past the real last page now happens on every url-pattern site (see the comment on
      // `max` above) — for a file:// mirror that page simply doesn't exist on disk, which Playwright
      // reports as a thrown navigation error (net::ERR_FILE_NOT_FOUND), not a resp.status() the check
      // below can see. That's expected here, not a real failure: treat it the same as "page not found"
      // and stop discovery, instead of letting it fail the whole run.
      let resp: Awaited<ReturnType<typeof gotoWithBackoff>>;
      try { resp = await gotoWithBackoff(p,url,run,"list"); } catch { break; }
      run.discoveredPages=n; if(!resp||resp.status()>=400) break; const itemSel=selector(recipe.list.item), detailSel=selector(recipe.list.detailUrl), avatarSel=selector(recipe.list.avatar); if(!itemSel||!detailSel) throw new Error("Recipe thiếu item/detail selector");
      // "list"-scoped fields (see RecipeField.scope) are read here, once per item, the same way
      // avatar/detailUrl already are — the only chance to read them, since some sites never repeat a
      // field (an excerpt, a category label) on the item's own detail page at all.
      const listFieldDefs = recipe.detail.fields.filter(f => f.scope === "list" && f.selector);
      // Two/three simple single-expression passes (not one complex callback with nested helpers) to
      // stay clear of the __name hazard above. All are evaluated over the same `itemSel` match set in
      // the same call, so their result arrays stay index-aligned with each other and with `els`.
      const [hrefsRaw, avatarsRaw, listFieldsRaw] = await Promise.all([
        p.locator(itemSel).evaluateAll((els, ds) => els.map(e => e.querySelector(ds)?.getAttribute("href") || null), detailSel),
        avatarSel
          ? p.locator(itemSel).evaluateAll((els, as) => els.map(e => e.querySelector(as)?.getAttribute("src") || e.querySelector(as)?.getAttribute("data-src") || e.querySelector(as)?.getAttribute("data-original") || null), avatarSel)
          : Promise.resolve<Array<string|null>>([]),
        Promise.all(listFieldDefs.map(f => {
          const fSel = selector(f.selector!);
          if (!fSel) return Promise.resolve<Array<string|null>>([]);
          return f.extraction === "html"
            ? p.locator(itemSel).evaluateAll((els, s) => els.map(e => e.querySelector(s)?.innerHTML || null), fSel)
            : p.locator(itemSel).evaluateAll((els, s) => els.map(e => (e.querySelector(s)?.textContent || "").trim() || null), fSel);
        }))
      ]);
      const avatarsAligned = avatarSel ? avatarsRaw : hrefsRaw.map(() => null);
      const canonMap = new Map<string,{ avatar: string[]; listFields: Record<string,string|null> }>();
      for (let i = 0; i < hrefsRaw.length; i++) {
        const href = hrefsRaw[i]; if (!href) continue;
        const c = canonicalize(href, url);
        if (canonMap.has(c)) continue;
        const avatarRaw = avatarsAligned[i];
        let avatar: string[] = [];
        if (avatarRaw) { try { avatar = [new URL(avatarRaw, url).href]; } catch { avatar = []; } }
        const listFields: Record<string,string|null> = {};
        listFieldDefs.forEach((f, fi) => { listFields[`${f.targetTable}.${f.targetColumn}`] = listFieldsRaw[fi]?.[i] ?? null; });
        canonMap.set(c, { avatar, listFields });
      }
      const canon=[...canonMap.keys()]; if(!canon.length) break; const fp=canon.sort().join("|"); if(fp===previousSet) break; previousSet=fp; let added=0;
      for(const u of canon){ if(run.queue.some(q=>q.canonicalUrl===u)) continue; const entry=canonMap.get(u)!; run.queue.push({id:randomUUID(),url:u,canonicalUrl:u,sourcePage:url,status:"pending",attempt:0,httpStatus:null,lastError:null,createdAt:new Date().toISOString(),startedAt:null,completedAt:null,avatarCandidates:entry.avatar.slice(0,3),listFields:entry.listFields}); added++; if(run.mode==="test") break; }
      await persist(); if(run.mode==="test"||added===0) break; }
 run.discoveryDone=true; log(run,"list","Discovery complete"); await persist(); } finally { await p.close(); } }
async function worker(run:CrawlRun, recipe:CrawlRecipe, workerId:number){ const b=browser ||= await chromium.launch({headless:true}); const p=await b.newPage(); try { while(!abortRequested.has(run.id)){ const q=run.queue.find(x=>x.status==="pending"); if(!q) break; q.status="running"; q.attempt++; q.startedAt=new Date().toISOString(); await persist(); try { log(run,"detail","Open detail",q.url,workerId); const resp=await gotoWithBackoff(p,q.url,run,"detail",workerId); q.httpStatus=resp?.status()??null; if(!resp||resp.status()>=400) throw new Error(`HTTP ${resp?.status()??"NO_RESPONSE"}`); q.extracted=await extractDetail(p,recipe); q.status="success"; q.completedAt=new Date().toISOString(); } catch(e){ q.status="failed"; q.lastError=e instanceof Error?e.message:String(e); q.completedAt=new Date().toISOString(); log(run,"detail","Detail failed",q.url,workerId,e); } await persist(); } } finally { await p.close(); } }
async function execute(run:CrawlRun, recipe:CrawlRecipe){ try { abortRequested.delete(run.id); if(!run.startedAt) run.startedAt=new Date().toISOString(); if(!run.discoveryDone) await discover(run,recipe); if(abortRequested.has(run.id)){run.status="paused";await persist();return;} run.status="running"; await persist(); await Promise.all(Array.from({length:run.workers},(_,i)=>worker(run,recipe,i+1))); run.status=abortRequested.has(run.id)?"paused":"completed"; if(run.status==="completed")run.completedAt=new Date().toISOString(); log(run,"run",run.status==="completed"?"Run completed":"Run paused"); await persist(); } catch(e){run.status="failed";log(run,"run","Run failed",null,null,e);await persist();} finally {activePromises.delete(run.id);} }
export async function startCrawl(recipe:CrawlRecipe, mode:"test"|"full", workers:number){ const safe=Math.max(1,Math.min(workers,8)); const run:CrawlRun={id:randomUUID(),recipeId:recipe.id,status:"idle",mode,workers:safe,maxWorkers:8,createdAt:new Date().toISOString(),startedAt:null,completedAt:null,discoveryDone:false,discoveredPages:0,queue:[],logs:[]}; runtime.runs.push(run);runtime.activeRunId=run.id;await persist(); const promise=execute(run,recipe);activePromises.set(run.id,promise);return run; }
export async function pauseCrawl(id:string){ const r=runtime.runs.find(x=>x.id===id);if(!r)throw new Error("Run không tồn tại");abortRequested.add(id);r.status="paused";for(const q of r.queue)if(q.status==="running")q.status="pending";await persist();return r; }
export async function resumeCrawl(id:string,recipe:CrawlRecipe){ const r=runtime.runs.find(x=>x.id===id);if(!r)throw new Error("Run không tồn tại");if(activePromises.has(id))return r;
  // Same self-heal as initCrawlRuntime's crash recovery: a stray "running" item left over from a
  // worker that never got to report its result is otherwise invisible to Resume (new workers only
  // ever pick up "pending" items), so it would sit there forever even after a successful resume.
  for (const q of r.queue) if (q.status==="running") { q.status="pending"; q.startedAt=null; }
  abortRequested.delete(id);const promise=execute(r,recipe);activePromises.set(id,promise);return r; }
export async function retryFailed(id:string,recipe:CrawlRecipe){ const r=runtime.runs.find(x=>x.id===id);if(!r)throw new Error("Run không tồn tại");for(const q of r.queue)if(q.status==="failed"){q.status="pending";q.lastError=null;q.completedAt=null;} r.status="paused";await persist();return resumeCrawl(id,recipe); }
export async function deleteCrawlRun(id:string){ const r=runtime.runs.find(x=>x.id===id); if(!r) throw new Error("Run không tồn tại"); if(["running","discovering"].includes(r.status)) throw new Error("Đang chạy — hãy Tạm dừng trước khi xóa."); runtime.runs=runtime.runs.filter(x=>x.id!==id); if(runtime.activeRunId===id) runtime.activeRunId=null; throttles.delete(id); await persist(); }
