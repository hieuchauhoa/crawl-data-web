import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import mysql from "mysql2/promise";
import type {
  AssetDownloadResult, CrawlQueueItem, CrawlRecipe, CrawlRun, ImportConflict, ImportDecision, ImportItemResult, ImportPreviewResult, ImportRun,
  SchemaColumn, SchemaTable, UrlRewriteRule, WorkspaceInfo
} from "@crawl/shared";
import { config, phase4Dir } from "./config.js";
import { applyUrlRewrite, AssetStore, assetExportName } from "./assets.js";

const statePath = path.join(phase4Dir, "import-state.json");
let runs: ImportRun[] = [];

export async function initMappingRuntime() {
  await fs.mkdir(phase4Dir, { recursive: true });
  try { runs = JSON.parse(await fs.readFile(statePath, "utf8")); } catch { runs = []; }
}
async function persist() { await fs.writeFile(statePath, JSON.stringify(runs, null, 2), "utf8"); }
export function getImportRuns() { return runs; }
export function getImportRun(id: string) { return runs.find(r => r.id === id) || null; }
export async function deleteImportRun(id: string) { const before = runs.length; runs = runs.filter(r => r.id !== id); if (runs.length === before) throw new Error("Import run không tồn tại"); await persist(); }

// --- Vietnamese-aware slug ---
const VN_MAP: Array<[RegExp, string]> = [
  [/[àáạảãâầấậẩẫăằắặẳẵ]/g, "a"], [/[ÀÁẠẢÃÂẦẤẬẨẪĂẰẮẶẲẴ]/g, "A"],
  [/[èéẹẻẽêềếệểễ]/g, "e"], [/[ÈÉẸẺẼÊỀẾỆỂỄ]/g, "E"],
  [/[ìíịỉĩ]/g, "i"], [/[ÌÍỊỈĨ]/g, "I"],
  [/[òóọỏõôồốộổỗơờớợởỡ]/g, "o"], [/[ÒÓỌỎÕÔỒỐỘỔỖƠỜỚỢỞỠ]/g, "O"],
  [/[ùúụủũưừứựửữ]/g, "u"], [/[ÙÚỤỦŨƯỪỨỰỬỮ]/g, "U"],
  [/[ỳýỵỷỹ]/g, "y"], [/[ỲÝỴỶỸ]/g, "Y"],
  [/đ/g, "d"], [/Đ/g, "D"]
];
export function slugify(input: string): string {
  let s = input;
  for (const [re, rep] of VN_MAP) s = s.replace(re, rep);
  s = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  s = s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/-{2,}/g, "-");
  return s || "item";
}

// Vietnamese sites almost always write prices with "." as a thousands separator and no decimal part
// at all (e.g. "86.000.000" = 86,000,000₫) — the opposite of what a lone "." means in most other
// locales. Left to the old last-separator heuristic, a price like that has no comma to compare
// against, so it fell through treating the LAST dot as a decimal point and produced "86.000.000" ->
// NaN (two "decimal points" is not a valid number) -> silently null. Detected first and explicitly,
// before the generic heuristic, since it's unambiguous whenever every group after the first is
// exactly 3 digits — a real decimal value is never grouped like that.
const THOUSANDS_GROUPED_DOT = /^-?\d{1,3}(\.\d{3})+$/;
const THOUSANDS_GROUPED_COMMA = /^-?\d{1,3}(,\d{3})+$/;
function parseNumber(raw: string, decimal: boolean): string | null {
  let s = raw.replace(/[^\d.,-]/g, "");
  if (!s) return null;
  if (decimal) {
    if (THOUSANDS_GROUPED_DOT.test(s)) s = s.replace(/\./g, "");
    else if (THOUSANDS_GROUPED_COMMA.test(s)) s = s.replace(/,/g, "");
    else {
      const lastComma = s.lastIndexOf(","), lastDot = s.lastIndexOf(".");
      s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
    }
  } else {
    s = s.replace(/[.,]/g, "");
  }
  const n = Number(s);
  return Number.isFinite(n) ? String(n) : null;
}

function parseDate(raw: string): string | null {
  const dmy = raw.match(/(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{4})/);
  if (dmy) { const [, d, mo, y] = dmy; return `${y}-${mo!.padStart(2, "0")}-${d!.padStart(2, "0")}`; }
  const iso = raw.match(/\d{4}-\d{2}-\d{2}/);
  if (iso) return iso[0];
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

// Beyond script/style/handlers, also strips class/id/style/data-* attributes: these carry the SOURCE
// site's own CSS hooks and JS bindings (e.g. a wrapping `<div class="tab-pane" id="info-pro-detail">`),
// which mean nothing — or actively clash — once the HTML is rendered inside the new site's own CSS.
// The element structure itself is kept; only its old-site-specific attributes are removed.
function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/ on[a-z]+="[^"]*"/gi, "")
    .replace(/ on[a-z]+='[^']*'/gi, "")
    .replace(/javascript:/gi, "")
    .replace(/\s(?:class|id|style|data-[\w-]+)\s*=\s*"[^"]*"/gi, "")
    .replace(/\s(?:class|id|style|data-[\w-]+)\s*=\s*'[^']*'/gi, "");
}
// Reduces an HTML fragment to plain text for use somewhere that must never contain markup (an SEO
// meta description/title fallback) — a raw HTML blob would otherwise show up literally as tags inside
// the meta tag. Also caps length, since these fallbacks can come from a full article body field.
function stripHtmlToText(html: string, maxLen: number): string | null {
  const text = html
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#0?39;/gi, "'")
    .replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > maxLen ? `${text.slice(0, maxLen - 1).trimEnd()}…` : text;
}

// Computed for a "generated" field (e.g. date_created/date_updated) at import time. Many legacy PHP
// schemas store these as an int column holding a Unix timestamp (PHP's time()) rather than a real
// SQL DATE/DATETIME type — auto-detecting from the column's own SQL type means the user never has to
// know or care which format their particular table expects.
function generatedValue(generator: "now-timestamp" | "now-date" | null | undefined, column: SchemaColumn): string {
  const now = new Date();
  const type = column.type.toLowerCase();
  if (generator === "now-timestamp" || (!generator && /int|bigint/.test(type))) return String(Math.floor(now.getTime() / 1000));
  if (/datetime|timestamp/.test(type)) return now.toISOString().slice(0, 19).replace("T", " ");
  return now.toISOString().slice(0, 10);
}
function transformValue(raw: string | null, column: SchemaColumn, extraction: string | undefined): string | null {
  if (raw == null) return null;
  const name = column.name.toLowerCase();
  const type = column.type.toLowerCase();
  if (extraction === "html" || extraction === "range") return sanitizeHtml(raw).trim() || null;
  if (/slug/.test(name)) return slugify(raw);
  if (/int|decimal|float|double/.test(type) && !/^id($|_)/.test(name)) return parseNumber(raw, /decimal|float|double/.test(type));
  if (/date|time/.test(type)) return parseDate(raw);
  const trimmed = raw.replace(/\s+/g, " ").trim();
  return trimmed || null;
}

// Downloads every <img src="..."> found in a content HTML blob and rewrites the src to the local
// flat export filename, so the content still renders after the source site goes away (charter §26).
// Only the plain src attribute is handled (not srcset) — acceptable for typical article/product HTML.
async function rewriteContentImages(
  html: string, baseUrl: string, referer: string, slug: string,
  store: AssetStore, exportDir: string, assetsOut: AssetDownloadResult[], rewriteRules: UrlRewriteRule[] | null | undefined
): Promise<string> {
  const seen = new Map<string, string>();
  let index = 0;
  const matches = [...html.matchAll(/<img\b[^>]*?\bsrc\s*=\s*(["'])(.*?)\1/gi)];
  let out = html;
  for (const m of matches) {
    const rawSrc = m[2];
    if (!rawSrc || /^data:/i.test(rawSrc)) continue;
    let abs: string;
    try { abs = applyUrlRewrite(new URL(rawSrc, baseUrl).href, rewriteRules); } catch { continue; }
    let exportName = seen.get(abs);
    if (exportName === undefined) {
      const result = await store.downloadOne(abs, "content", referer);
      assetsOut.push(result);
      if (result.status !== "error" && result.sha256 && result.ext) {
        exportName = assetExportName(slug, "content", result.sha256, result.ext, index++);
        await store.exportFlat(result, exportName, exportDir);
        result.exportName = exportName;
      } else {
        exportName = "";
      }
      seen.set(abs, exportName);
    }
    if (exportName) out = out.split(m[0]).join(m[0].replace(rawSrc, `assets/${exportName}`));
  }
  return out;
}

function findColumn(table: SchemaTable | undefined, name: string): SchemaColumn | undefined {
  return table?.columns.find(c => c.name === name);
}
function findColumnLike(table: SchemaTable | undefined, pattern: RegExp): SchemaColumn | undefined {
  return table?.columns.find(c => pattern.test(c.name));
}
// A schema can carry several columns matching the same loose pattern (namevi/nameen, descvi/descen —
// common on bilingual sites) in an order that has nothing to do with which one the Recipe actually
// maps. Picking blindly by schema order can silently choose the *unmapped, always-empty* column
// (e.g. nameen when only namevi was ever crawled) — slug generation and SEO fallback would then have
// nothing to work from and produce NULL with no error anywhere, since nothing actually throws.
// This picks a same-suffix match first (so a "slugvi" column pairs with "namevi", not "nameen"),
// then any matching column that actually has a value this item, before falling back to schema order.
function pickColumnWithValue(table: SchemaTable | undefined, pattern: RegExp, values: Record<string, string | null>, preferName?: string): string | null {
  if (!table) return null;
  const candidates = table.columns.filter(c => pattern.test(c.name));
  if (preferName) { const hit = candidates.find(c => c.name.toLowerCase() === preferName.toLowerCase() && values[c.name]); if (hit) return hit.name; }
  return candidates.find(c => values[c.name])?.name || candidates[0]?.name || null;
}

type Conn = mysql.Connection;

// Every real INSERT is appended here as a structured record. delta.sql (Phase 6 export) replays
// these as literal SQL statements — the log is the single source of truth for "what did the crawler
// actually write", independent of re-deriving it from current DB state. importRunId ties each entry
// back to the specific Import run that wrote it, which is what makes rollbackImportRun (below) able to
// find and undo exactly one run's rows without touching any other run's — without it, "wrong config,
// re-imported without dedup, now there are duplicates" (a recurring real case) had no fix short of
// hand-editing the database directly.
async function logDelta(deltaLogPath: string, table: string, columns: string[], values: unknown[], importRunId: string | null) {
  await fs.appendFile(deltaLogPath, `${JSON.stringify({ table, columns, values, importRunId, at: new Date().toISOString() })}\n`, "utf8");
}

async function findOrCreateCategory(
  conn: Conn, table: SchemaTable, nameColumn: string, text: string,
  parentColumn: string | null, parentId: number | null,
  cache: Map<string, number>, deltaLogPath: string, importRunId: string,
  extraDefaults?: Record<string, string | null>
): Promise<number> {
  const normalized = text.replace(/\s+/g, " ").trim();
  const cacheKey = `${table.name}::${nameColumn}::${normalized}::${parentColumn ? parentId ?? "" : ""}`;
  const cached = cache.get(cacheKey);
  if (cached != null) return cached;

  const whereParts = [`\`${nameColumn}\` = ?`];
  const params: unknown[] = [normalized];
  if (parentColumn) { whereParts.push(`\`${parentColumn}\` <=> ?`); params.push(parentId); }
  const [rows] = await conn.query(`SELECT id FROM \`${table.name}\` WHERE ${whereParts.join(" AND ")} LIMIT 1`, params);
  const existing = (rows as Array<{ id: number }>)[0];
  if (existing) { cache.set(cacheKey, existing.id); return existing.id; }

  const insertCols = [nameColumn];
  const insertVals: unknown[] = [normalized];
  if (parentColumn) { insertCols.push(parentColumn); insertVals.push(parentId); }
  // A category row created purely from breadcrumb text still needs its own slug filled in — templates
  // that build category URLs from it (e.g. a site's main nav) otherwise hit an undefined/blank slug on
  // every page that renders that menu, not just on the crawled item that happened to create the row.
  for (const slugCol of table.columns.filter(c => /slug/i.test(c.name) && c.name !== nameColumn)) {
    if (!insertCols.includes(slugCol.name)) { insertCols.push(slugCol.name); insertVals.push(slugify(normalized)); }
  }
  // Default-value columns configured for this table (constant/generated, via the DefaultValueEditor)
  // land here too — a category/list row is still a row in a table the recipe maps fields onto, but
  // being reached through breadcrumb resolution rather than the generic parent-pointing related-table
  // insert loop meant those defaults never made it into the INSERT below.
  for (const [col, val] of Object.entries(extraDefaults || {})) {
    if (val != null && !insertCols.includes(col)) { insertCols.push(col); insertVals.push(val); }
  }
  const [result] = await conn.query(
    `INSERT INTO \`${table.name}\` (${insertCols.map(c => `\`${c}\``).join(",")}) VALUES (${insertCols.map(() => "?").join(",")})`,
    insertVals
  );
  const insertId = (result as mysql.ResultSetHeader).insertId;
  await logDelta(deltaLogPath, table.name, [...insertCols, "id"], [...insertVals, insertId], importRunId);
  cache.set(cacheKey, insertId);
  return insertId;
}

// Shared by the real import and the conflict preview so both agree on exactly what would be written —
// a preview that computed values a different way than the real run could show "no conflict" and then
// actually collide, or vice versa.
function buildMainValues(item: CrawlQueueItem, recipe: CrawlRecipe, schemaByName: Map<string, SchemaTable>, mainTable: string, mainSchema: SchemaTable) {
  const fieldsByTable = new Map<string, Record<string, string | null>>();
  const htmlFields: Array<{ table: string; column: string }> = [];
  for (const f of recipe.detail.fields) {
    const table = schemaByName.get(f.targetTable);
    const column = findColumn(table, f.targetColumn);
    if (!column) continue;
    if (f.extraction === "html" || f.extraction === "range") htmlFields.push({ table: f.targetTable, column: f.targetColumn });
    // A constant field's value is authored on the recipe itself (f.sampleValue), never read off the
    // page — it must apply even to items crawled *before* the default was added (extracted.fields has
    // no entry for a column that didn't exist on the recipe yet at crawl time), so it can't be looked
    // up through the same extracted-fields path as a real DOM field.
    // Like a constant field, the crawled item's own URL is metadata the Tool already has (item.url) —
    // never something read off the page's DOM — so it's computed straight from the queue item here
    // too, independent of whatever the recipe's fields looked like back when this item was crawled.
    const value = f.extraction === "generated"
      ? generatedValue(f.generator, column)
      : f.extraction === "constant"
      ? (f.sampleValue ?? null)
      : f.extraction === "source-url"
      ? applyUrlRewrite(item.url, f.urlRewrite)
      // A "list"-scoped field's raw value was read during list-page discovery (item.listFields), not
      // from item.extracted.fields — the detail-page crawl never even looks for it there.
      : f.scope === "list"
      ? transformValue(item.listFields?.[`${f.targetTable}.${f.targetColumn}`] ?? null, column, f.extraction)
      : transformValue(item.extracted!.fields[`${f.targetTable}.${f.targetColumn}`] ?? null, column, f.extraction);
    if (!fieldsByTable.has(f.targetTable)) fieldsByTable.set(f.targetTable, {});
    fieldsByTable.get(f.targetTable)![f.targetColumn] = value;
  }
  const mainValues = fieldsByTable.get(mainTable) || {};
  for (const slugCol of mainSchema.columns.filter(c => /slug/i.test(c.name))) {
    if (mainValues[slugCol.name]) continue;
    const preferName = slugCol.name.toLowerCase().replace(/^slug/, "name");
    const nameCol = pickColumnWithValue(mainSchema, /^name/i, mainValues, preferName);
    if (nameCol && mainValues[nameCol]) mainValues[slugCol.name] = slugify(mainValues[nameCol]!);
  }
  return { fieldsByTable, mainValues, htmlFields };
}

function mariaConnConfig(workspace: WorkspaceInfo) {
  return { host: config.maria.host, port: config.maria.port, user: config.maria.user, password: config.maria.password, charset: "utf8mb4", database: workspace.database };
}

// Deletes every row a specific Import run actually wrote (main record, related/SEO/gallery rows, and
// any category row it created), using the delta log's own recorded ids as the source of truth — the
// same log that already drives the delta.sql export. This is the fix for the recurring real case
// where a workspace had no dedup configured yet (or the wrong one), got re-imported a few times while
// getting it right, and ended up with duplicate rows the operator had no way to remove short of hand-
// editing the database directly. Rolled-back entries are stripped from the log afterwards so a later
// delta.sql export doesn't try to replay rows that no longer exist.
export async function rollbackImportRun(workspace: WorkspaceInfo, importRun: ImportRun): Promise<{ deletedRows: number; tables: string[] }> {
  let raw = "";
  try { raw = await fs.readFile(workspace.deltaLogPath, "utf8"); } catch { return { deletedRows: 0, tables: [] }; }
  const lines = raw.split("\n").filter(Boolean);
  const mine: Array<{ table: string; id: unknown }> = [];
  const kept: string[] = [];
  for (const line of lines) {
    let rec: { table: string; columns: string[]; values: unknown[]; importRunId?: string | null } | null = null;
    try { rec = JSON.parse(line); } catch { kept.push(line); continue; }
    if (!rec || rec.importRunId !== importRun.id) { kept.push(line); continue; }
    const idIndex = rec.columns.indexOf("id");
    if (idIndex >= 0) mine.push({ table: rec.table, id: rec.values[idIndex] });
  }
  if (!mine.length) return { deletedRows: 0, tables: [] };
  const byTable = new Map<string, unknown[]>();
  for (const m of mine) { if (!byTable.has(m.table)) byTable.set(m.table, []); byTable.get(m.table)!.push(m.id); }
  const conn = await mysql.createConnection(mariaConnConfig(workspace));
  let deletedRows = 0;
  try {
    for (const [table, ids] of byTable) {
      const [result] = await conn.query(`DELETE FROM \`${table}\` WHERE id IN (${ids.map(() => "?").join(",")})`, ids);
      deletedRows += (result as mysql.ResultSetHeader).affectedRows;
    }
  } finally { await conn.end(); }
  await fs.writeFile(workspace.deltaLogPath, kept.length ? `${kept.join("\n")}\n` : "", "utf8");
  importRun.rolledBack = true;
  await persist();
  return { deletedRows, tables: [...byTable.keys()] };
}

// Computes which crawled items collide with an existing row under the configured match columns,
// without writing anything — shown to the operator (FileZilla-style "this file already exists")
// before any real Import so "skip" is a reviewed choice, not a silent default, when there's anything
// to review. No conflicts means no review screen: the common case (all-new items) stays one click.
export async function previewImportConflicts(workspace: WorkspaceInfo, recipe: CrawlRecipe, run: CrawlRun): Promise<ImportPreviewResult> {
  const cfg = workspace.config;
  const mainTable = cfg.mainTable;
  if (!mainTable) throw new Error("Chưa chọn main table cho workspace.");
  const schemaByName = new Map(workspace.schema.tables.map(t => [t.name, t]));
  const mainSchema = schemaByName.get(mainTable);
  if (!mainSchema) throw new Error(`Không tìm thấy schema của bảng ${mainTable}.`);
  const conn = await mysql.createConnection(mariaConnConfig(workspace));
  const conflicts: ImportConflict[] = [];
  let totalSuccess = 0;
  try {
    for (const item of run.queue) {
      if (item.status !== "success" || !item.extracted) continue;
      totalSuccess++;
      if (!cfg.existingRecord || !cfg.existingRecord.matchColumns.length) continue;
      const { mainValues } = buildMainValues(item, recipe, schemaByName, mainTable, mainSchema);
      const cols = cfg.existingRecord.matchColumns.filter(c => mainValues[c] != null);
      if (cols.length !== cfg.existingRecord.matchColumns.length || !cols.length) continue;
      const [rows] = await conn.query(`SELECT id FROM \`${mainTable}\` WHERE ${cols.map(c => `\`${c}\` = ?`).join(" AND ")} LIMIT 1`, cols.map(c => mainValues[c]));
      const existing = (rows as Array<{ id: number }>)[0];
      if (existing) {
        const matchedOn: Record<string, string | null> = {};
        for (const c of cols) matchedOn[c] = mainValues[c] ?? null;
        conflicts.push({ queueItemId: item.id, url: item.url, matchedId: existing.id, matchedOn });
      }
    }
  } finally { await conn.end(); }
  return { runId: run.id, recipeId: recipe.id, totalSuccess, conflicts };
}

export async function importCrawlRun(workspace: WorkspaceInfo, recipe: CrawlRecipe, run: CrawlRun, decisions?: Record<string, ImportDecision>): Promise<ImportRun> {
  const importRun: ImportRun = {
    id: randomUUID(), runId: run.id, recipeId: recipe.id, createdAt: new Date().toISOString(),
    completedAt: null, inserted: 0, updated: 0, skipped: 0, failed: 0, insertedRows: 0,
    assetsDownloaded: 0, assetsReused: 0, assetsFailed: 0, items: []
  };
  runs.push(importRun);
  await persist();

  const cfg = workspace.config;
  const mainTable = cfg.mainTable;
  if (!mainTable) throw new Error("Chưa chọn main table cho workspace.");
  const schemaByName = new Map(workspace.schema.tables.map(t => [t.name, t]));
  const mainSchema = schemaByName.get(mainTable);
  if (!mainSchema) throw new Error(`Không tìm thấy schema của bảng ${mainTable}.`);

  const conn = await mysql.createConnection(mariaConnConfig(workspace));

  const assetStore = new AssetStore(workspace.assetsStoreDir);
  await assetStore.init();

  const categoryCache = new Map<string, number>();

  try {
    for (const item of run.queue) {
      if (item.status !== "success" || !item.extracted) continue;
      const result: ImportItemResult = { queueItemId: item.id, url: item.url, status: "error", mainId: null, error: null, assets: [] };
      try {
        // 1-2. Build transformed field values + auto slug (shared with previewImportConflicts, so the
        // preview and the real write always agree on what the record looks like).
        const { fieldsByTable, mainValues, htmlFields } = buildMainValues(item, recipe, schemaByName, mainTable, mainSchema);

        // 3. Existing-record check (before any writes). An explicit per-item decision (from a reviewed
        // conflict list) always wins; with none, this falls back to the original blanket behavior:
        // auto-skip on match, insert otherwise — so calling this without `decisions` at all behaves
        // exactly as before conflict review existed.
        const decision = decisions?.[item.id];
        let existingId: number | null = null;
        if (decision !== "insert" && cfg.existingRecord && cfg.existingRecord.matchColumns.length) {
          const cols = cfg.existingRecord.matchColumns.filter(c => mainValues[c] != null);
          if (cols.length === cfg.existingRecord.matchColumns.length && cols.length > 0) {
            const [rows] = await conn.query(
              `SELECT id FROM \`${mainTable}\` WHERE ${cols.map(c => `\`${c}\` = ?`).join(" AND ")} LIMIT 1`,
              cols.map(c => mainValues[c])
            );
            existingId = (rows as Array<{ id: number }>)[0]?.id ?? null;
          }
        }
        if (existingId != null && decision !== "overwrite") {
          result.status = "skipped"; result.mainId = existingId; importRun.skipped++; importRun.items.push(result); continue;
        }

        // 4. Category resolver from breadcrumb -> assign relation columns on main table.
        const lastResolvedByTable = new Map<string, number>();
        const ownNameCol = pickColumnWithValue(mainSchema, /^name/i, mainValues);
        const ownName = ownNameCol ? mainValues[ownNameCol] : null;
        for (const level of [...recipe.list.breadcrumb].sort((a, b) => a.index - b.index)) {
          if (level.ignored || !level.targetTable || !level.targetColumn) continue;
          // A breadcrumb level mapped to the main table itself is never a real category — it's most
          // often the last crumb (the item's own title, e.g. a mapping picker's default fallback) and
          // resolving it here would look up-or-INSERT a bogus row into the main product/news table
          // using just that one column, as a pure side effect of "categorizing" the item.
          if (level.targetTable === mainTable) continue;
          const crumb = item.extracted.breadcrumb.find(b => b.index === level.index);
          if (!crumb || !crumb.text.trim()) continue;
          // Breadcrumb selectors are position-based (e.g. "3rd breadcrumb item"); on a product whose
          // breadcrumb has a different depth than the sample used to configure the Recipe, that same
          // position can drift onto the item's own title instead of the intended category level. A
          // crumb that IS the product's own name is never a real category — cheap self-consistency
          // check catches this without needing to redesign breadcrumb selection to be depth-aware.
          if (ownName && crumb.text.trim().toLowerCase() === ownName.trim().toLowerCase()) continue;
          const catTable = schemaByName.get(level.targetTable);
          if (!catTable) continue;
          const parentCol = findColumnLike(catTable, /^(id_)?parent(_id)?$/i)?.name || null;
          const parentId = parentCol ? lastResolvedByTable.get(level.targetTable) ?? null : null;
          const resolvedId = await findOrCreateCategory(conn, catTable, level.targetColumn, crumb.text, parentCol, parentId, categoryCache, workspace.deltaLogPath, importRun.id, fieldsByTable.get(level.targetTable));
          lastResolvedByTable.set(level.targetTable, resolvedId);
          const relation = cfg.relations.find(r => r.status === "confirmed" && r.sourceTable === mainTable && r.targetTable === level.targetTable);
          if (relation) mainValues[relation.sourceColumn] = String(resolvedId);
        }

        // 5. Assets: avatar (best candidate), gallery (every candidate, one row each), and inline
        // content images inside HTML fields — downloaded/deduped/exported before the DB transaction
        // so the transaction itself only ever does fast local INSERTs.
        const slugForAssetsCol = pickColumnWithValue(mainSchema, /slug/i, mainValues);
        const slugForAssets = (slugForAssetsCol && mainValues[slugForAssetsCol]) || item.id;
        const galleryRows: Array<{ value: string }> = [];
        if (cfg.assets?.avatarColumn && cfg.assets.avatarColumn.table === mainTable && item.avatarCandidates.length) {
          const avatarResult = await assetStore.downloadBestOf(item.avatarCandidates.map(u => applyUrlRewrite(u, cfg.assets?.urlRewrite)), "avatar", item.sourcePage);
          if (avatarResult) {
            result.assets.push(avatarResult);
            if (avatarResult.status !== "error" && avatarResult.sha256 && avatarResult.ext) {
              const exportName = assetExportName(slugForAssets, "avatar", avatarResult.sha256, avatarResult.ext);
              await assetStore.exportFlat(avatarResult, exportName, workspace.assetsExportDir);
              avatarResult.exportName = exportName;
              mainValues[cfg.assets.avatarColumn.column] = exportName;
            }
          }
        }
        if (cfg.assets?.galleryTable && item.extracted.galleryCandidates.length) {
          let gi = 0;
          for (const rawUrl of item.extracted.galleryCandidates) {
            const url = applyUrlRewrite(rawUrl, cfg.assets?.urlRewrite);
            const r = await assetStore.downloadOne(url, "gallery", item.url);
            result.assets.push(r);
            if (r.status !== "error" && r.sha256 && r.ext) {
              const exportName = assetExportName(slugForAssets, "gallery", r.sha256, r.ext, gi++);
              await assetStore.exportFlat(r, exportName, workspace.assetsExportDir);
              r.exportName = exportName;
              galleryRows.push({ value: exportName });
            }
          }
        }
        for (const { table, column } of htmlFields) {
          const values = fieldsByTable.get(table);
          const html = values?.[column];
          if (!html) continue;
          values![column] = await rewriteContentImages(html, item.url, item.url, slugForAssets, assetStore, workspace.assetsExportDir, result.assets, cfg.assets?.urlRewrite);
        }

        // 6. Insert main record + related/SEO/gallery rows inside one transaction. Delta records are
        // buffered and only written to disk after commit succeeds, so a rolled-back transaction never
        // leaves phantom entries in delta.sql.
        const deltaBuffer: Array<{ table: string; columns: string[]; values: unknown[] }> = [];
        await conn.beginTransaction();
        try {
          const isOverwrite = existingId != null && decision === "overwrite";
          const mainCols = Object.keys(mainValues).filter(c => mainValues[c] != null && c !== "id");
          let mainId: number;
          if (isOverwrite) {
            await conn.query(
              `UPDATE \`${mainTable}\` SET ${mainCols.map(c => `\`${c}\`=?`).join(",")} WHERE id=?`,
              [...mainCols.map(c => mainValues[c]), existingId]
            );
            mainId = existingId!;
            // Overwrite fully regenerates dependent rows from this crawl rather than diffing them —
            // simpler and correct as long as gallery/SEO/related rows are always rebuilt from scratch,
            // which the code below already does unconditionally.
            if (cfg.assets?.galleryTable) await conn.query(`DELETE FROM \`${cfg.assets.galleryTable.table}\` WHERE \`${cfg.assets.galleryTable.parentColumn}\` = ?`, [mainId]);
            if (cfg.seo) await conn.query(`DELETE FROM \`${cfg.seo.seoTable}\` WHERE \`${cfg.seo.parentColumn}\` = ? AND \`${cfg.seo.comColumn}\` = ? AND \`${cfg.seo.actColumn}\` = ? AND \`${cfg.seo.typeColumn}\` = ?`, [mainId, cfg.seo.com, cfg.seo.act, cfg.seo.type]);
            for (const [relTable] of fieldsByTable) {
              if (relTable === mainTable || (cfg.seo && relTable === cfg.seo.seoTable)) continue;
              const rel = cfg.relations.find(r => r.status === "confirmed" && r.sourceTable === relTable && r.targetTable === mainTable);
              if (rel) await conn.query(`DELETE FROM \`${relTable}\` WHERE \`${rel.sourceColumn}\` = ?`, [mainId]);
            }
          } else {
            const [mainResult] = await conn.query(
              `INSERT INTO \`${mainTable}\` (${mainCols.map(c => `\`${c}\``).join(",")}) VALUES (${mainCols.map(() => "?").join(",")})`,
              mainCols.map(c => mainValues[c])
            );
            mainId = (mainResult as mysql.ResultSetHeader).insertId;
          }
          let insertedRows = 1;
          deltaBuffer.push({ table: mainTable, columns: [...mainCols, "id"], values: [...mainCols.map(c => mainValues[c]), mainId] });

          // Related tables (excluding the SEO table) with a parent-pointing confirmed relation.
          for (const [table, values] of fieldsByTable) {
            if (table === mainTable) continue;
            if (cfg.seo && table === cfg.seo.seoTable) continue;
            const relation = cfg.relations.find(r => r.status === "confirmed" && r.sourceTable === table && r.targetTable === mainTable);
            if (!relation) continue;
            const cols = Object.keys(values).filter(c => values[c] != null);
            const insertCols = [relation.sourceColumn, ...cols];
            const insertVals: unknown[] = [mainId, ...cols.map(c => values[c])];
            await conn.query(
              `INSERT INTO \`${table}\` (${insertCols.map(c => `\`${c}\``).join(",")}) VALUES (${insertCols.map(() => "?").join(",")})`,
              insertVals
            );
            insertedRows++;
            deltaBuffer.push({ table, columns: insertCols, values: insertVals });
          }

          // Gallery: one row per successfully downloaded image, all pointing at the same parent. Any
          // other default-value columns configured for this table (e.g. type/com/kind/val, set via the
          // DefaultValueEditor) live in fieldsByTable under the gallery table's name — they were being
          // silently dropped here since only parentColumn/pathColumn were ever written, so a default
          // set on the gallery table never actually reached the database.
          if (cfg.assets?.galleryTable && galleryRows.length) {
            const { table, parentColumn, pathColumn } = cfg.assets.galleryTable;
            const extra = fieldsByTable.get(table) || {};
            const extraCols = Object.keys(extra).filter(c => extra[c] != null && c !== parentColumn && c !== pathColumn);
            for (const row of galleryRows) {
              const insertCols = [parentColumn, pathColumn, ...extraCols];
              const insertVals: unknown[] = [mainId, row.value, ...extraCols.map(c => extra[c])];
              await conn.query(
                `INSERT INTO \`${table}\` (${insertCols.map(c => `\`${c}\``).join(",")}) VALUES (${insertCols.map(() => "?").join(",")})`,
                insertVals
              );
              insertedRows++;
              deltaBuffer.push({ table, columns: insertCols, values: insertVals });
            }
          }

          // SEO insert (mandatory best-effort per charter: never fabricate keywords, prefer original meta).
          if (cfg.seo) {
            const seoData = item.extracted.seo;
            const nameCol = pickColumnWithValue(mainSchema, /^name/i, mainValues);
            // Prefer an actual "desc"-prefixed column (a short description) over a "content" column
            // (the full article/product body) — falling back to content only when no desc column
            // exists at all, and always as plain text: a raw HTML blob must never land in a meta tag.
            const descCol = pickColumnWithValue(mainSchema, /^desc/i, mainValues) || pickColumnWithValue(mainSchema, /^content/i, mainValues);
            const title = seoData.title || seoData.ogTitle || (nameCol && mainValues[nameCol] ? stripHtmlToText(mainValues[nameCol]!, 70) : null) || null;
            const description = seoData.description || seoData.ogDescription || (descCol && mainValues[descCol] ? stripHtmlToText(mainValues[descCol]!, 160) : null) || null;
            const keywords = seoData.keywords || null;
            const insertCols = [cfg.seo.parentColumn, cfg.seo.comColumn, cfg.seo.actColumn, cfg.seo.typeColumn];
            const insertVals: unknown[] = [mainId, cfg.seo.com, cfg.seo.act, cfg.seo.type];
            if (cfg.seo.titleColumn) { insertCols.push(cfg.seo.titleColumn); insertVals.push(title); }
            if (cfg.seo.descriptionColumn) { insertCols.push(cfg.seo.descriptionColumn); insertVals.push(description); }
            if (cfg.seo.keywordsColumn) { insertCols.push(cfg.seo.keywordsColumn); insertVals.push(keywords); }
            deltaBuffer.push({ table: cfg.seo.seoTable, columns: insertCols, values: insertVals });
            await conn.query(
              `INSERT INTO \`${cfg.seo.seoTable}\` (${insertCols.map(c => `\`${c}\``).join(",")}) VALUES (${insertCols.map(() => "?").join(",")})`,
              insertVals
            );
            insertedRows++;
          }

          await conn.commit();
          for (const d of deltaBuffer) await logDelta(workspace.deltaLogPath, d.table, d.columns, d.values, importRun.id);
          result.status = isOverwrite ? "updated" : "inserted"; result.mainId = mainId;
          if (isOverwrite) importRun.updated++; else importRun.inserted++;
          importRun.insertedRows += insertedRows;
        } catch (error) {
          await conn.rollback();
          throw error;
        }
      } catch (error) {
        result.status = "error"; result.error = error instanceof Error ? error.message : String(error);
        importRun.failed++;
      }
      for (const a of result.assets) {
        if (a.status === "downloaded") importRun.assetsDownloaded++;
        else if (a.status === "reused") importRun.assetsReused++;
        else importRun.assetsFailed++;
      }
      importRun.items.push(result);
      await persist();
    }
  } finally {
    await conn.end();
  }

  importRun.completedAt = new Date().toISOString();
  await persist();
  return importRun;
}
