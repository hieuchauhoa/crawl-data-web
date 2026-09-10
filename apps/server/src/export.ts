import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import archiver from "archiver";
import type { CrawlRecipe, CrawlRuntimeState, ExportBundleResult, ImportRun, WorkspaceInfo } from "@crawl/shared";
import { dumpDatabase, sha256File } from "./db.js";

function sqlLiteral(v: unknown): string {
  if (v == null) return "NULL";
  if (typeof v === "number") return String(v);
  const s = String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\0/g, "\\0");
  return `'${s}'`;
}

// Renders the append-only delta log (one JSON record per real INSERT, written by mapping.ts only
// after its transaction committed) into literal INSERT statements — this is deliberately a replay
// of what actually happened, not a re-derived diff of current vs. baseline DB state.
async function buildDeltaSql(deltaLogPath: string): Promise<string> {
  let raw = "";
  try { raw = await fs.readFile(deltaLogPath, "utf8"); } catch { return "-- (không có thay đổi mới)\n"; }
  const lines = raw.split("\n").map(l => l.trim()).filter(Boolean);
  if (!lines.length) return "-- (không có thay đổi mới)\n";
  const statements: string[] = [];
  for (const line of lines) {
    try {
      const rec = JSON.parse(line) as { table: string; columns: string[]; values: unknown[] };
      const cols = rec.columns.map(c => `\`${c}\``).join(",");
      const vals = rec.values.map(sqlLiteral).join(",");
      statements.push(`INSERT INTO \`${rec.table}\` (${cols}) VALUES (${vals});`);
    } catch { /* skip a malformed line rather than fail the whole export */ }
  }
  return `${statements.join("\n")}\n`;
}

export async function buildExportBundle(
  workspace: WorkspaceInfo, recipes: CrawlRecipe[], crawlRuntime: CrawlRuntimeState, importRuns: ImportRun[]
): Promise<ExportBundleResult> {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const workDir = path.join(workspace.exportDir, `bundle-${stamp}`);
  await fs.mkdir(workDir, { recursive: true });

  const finalSqlPath = path.join(workDir, "final.sql");
  await dumpDatabase(workspace.database, finalSqlPath);
  const finalSqlBytes = (await fs.stat(finalSqlPath)).size;

  const deltaSql = await buildDeltaSql(workspace.deltaLogPath);
  const deltaSqlPath = path.join(workDir, "delta.sql");
  await fs.writeFile(deltaSqlPath, deltaSql, "utf8");
  const deltaSqlBytes = Buffer.byteLength(deltaSql, "utf8");

  await fs.writeFile(path.join(workDir, "recipe.json"), JSON.stringify(recipes, null, 2), "utf8");

  const logsDir = path.join(workDir, "logs");
  await fs.mkdir(logsDir, { recursive: true });
  await fs.writeFile(path.join(logsDir, "crawl-runs.json"), JSON.stringify(crawlRuntime.runs, null, 2), "utf8");
  await fs.writeFile(path.join(logsDir, "import-runs.json"), JSON.stringify(importRuns, null, 2), "utf8");

  // Files are named "{slug}-{avatar|gallery|content}[-NN]-{hash}.{ext}" (assetExportName in assets.ts).
  // The internal flat folder and the DB's own stored filenames are left exactly as-is — only the
  // zip's presentation is split into per-kind subfolders, so nothing about already-written DB rows
  // needs to change to get "avatar/gallery/content in separate folders" in the delivered package.
  let assetCount = 0;
  const assetFiles: Array<{ path: string; kind: string; name: string }> = [];
  if (fssync.existsSync(workspace.assetsExportDir)) {
    const names = await fs.readdir(workspace.assetsExportDir);
    assetCount = names.length;
    for (const name of names) {
      const kind = name.match(/-(avatar|gallery|content)(?:-\d+)?-[0-9a-f]{6,}\.[a-z0-9]+$/i)?.[1]?.toLowerCase() || "other";
      assetFiles.push({ path: path.join(workspace.assetsExportDir, name), kind, name });
    }
  }

  const zipName = `crawl-export-${stamp}.zip`;
  const zipPath = path.join(workspace.exportDir, zipName);
  await new Promise<void>((resolve, reject) => {
    const output = fssync.createWriteStream(zipPath);
    const archive = archiver("zip", { zlib: { level: 9 } });
    output.on("close", resolve);
    archive.on("error", reject);
    archive.pipe(output);
    archive.file(finalSqlPath, { name: "final.sql" });
    archive.file(deltaSqlPath, { name: "delta.sql" });
    archive.file(path.join(workDir, "recipe.json"), { name: "recipe.json" });
    archive.directory(logsDir, "logs");
    for (const f of assetFiles) archive.file(f.path, { name: `assets/${f.kind}/${f.name}` });
    void archive.finalize();
  });
  await fs.rm(workDir, { recursive: true, force: true });

  return {
    fileName: zipName,
    downloadUrl: `/api/export/download/${encodeURIComponent(zipName)}`,
    sha256: await sha256File(zipPath),
    createdAt: new Date().toISOString(),
    finalSqlBytes, deltaSqlBytes, assetCount, recipeCount: recipes.length
  };
}
