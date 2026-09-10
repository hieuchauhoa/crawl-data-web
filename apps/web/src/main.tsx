import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AssetMappingConfig, CrawlQueueItem, CrawlRecipe, CrawlRun, CrawlRuntimeState, ExistingRecordPolicy, ExportBundleResult, ImportConflict, ImportDecision, ImportRun, Phase0State, RecipeField, RelationSuggestion, SchemaTable, SeoMappingConfig, TableRowsResult, UrlRewriteRule, WorkspaceConfig, WorkspaceInfo } from "@crawl/shared";
import "./styles.css";

type Health = { ok: boolean; phase: number; serverTime: string; mariadb: { ok: boolean; version?: string; error?: string } };
const EMPTY: Phase0State = { lastExtensionSeen: null, lastPageUrl: null, database: null, repeatedItem: null, detailUrl: null, detailField: null, seo: null, activeRecipeId: null, recipes: [], events: [] };

type Theme = "light" | "dark";
const THEME_KEY = "crawl-tool-theme";
function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => (localStorage.getItem(THEME_KEY) as Theme) || "light");
  useEffect(() => { document.documentElement.setAttribute("data-theme", theme); localStorage.setItem(THEME_KEY, theme); }, [theme]);
  return <button type="button" className="theme-toggle secondary small" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>{theme === "light" ? "Chuyển tối" : "Chuyển sáng"}</button>;
}

// Groups controls that belong to the same concern within one Step card (e.g. "SEO" vs "Ảnh sản phẩm"
// vs "Chống trùng lặp" inside Step 5, which used to be one long unbroken stack of unrelated toggles).
function SubSection({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <div className="sub-section">
    <div className="sub-section-head"><span className="sub-section-title">{title}</span></div>
    {hint && <p className="sub-section-hint">{hint}</p>}
    {children}
  </div>;
}

function Badge({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return <span className={`badge ${ok ? "ok" : "bad"}`}>{children}</span>;
}

function SchemaTableView({ table, onBrowse }: { table: SchemaTable; onBrowse: (table: string) => void }) {
  return <details className="schema-table"><summary><strong>{table.name}</strong><span>{table.columns.length} cột · ~{table.estimatedRows ?? "?"} dòng</span><button className="small secondary" onClick={e => { e.preventDefault(); onBrowse(table.name); }}>Xem dữ liệu</button></summary><div className="table-scroll"><table><thead><tr><th>Cột</th><th>Kiểu</th><th>Null</th><th>Key</th><th>Mặc định</th></tr></thead><tbody>{table.columns.map(c => <tr key={c.name}><td>{c.name}</td><td><code>{c.type}</code></td><td>{c.nullable ? "Có" : "Không"}</td><td>{c.key || "—"}</td><td>{c.defaultValue ?? "NULL"}</td></tr>)}</tbody></table></div></details>;
}

function CountPill({ label, value, tone = "neutral" }: { label: string; value: number; tone?: "neutral" | "good" | "bad" | "active" }) {
  return <div className={`count-pill ${tone}`}><strong>{value}</strong><span>{label}</span></div>;
}

function truncate(value: string | null | undefined, max = 300) {
  if (!value) return "—";
  const clean = value.trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function ExtractedPreview({ item }: { item: CrawlQueueItem }) {
  const [open, setOpen] = useState(true);
  if (!item.extracted) return null;
  const { fields, seo, breadcrumb } = item.extracted;
  const fieldEntries = Object.entries(fields);
  return <div className="preview-box">
    <div className="preview-head" onClick={() => setOpen(!open)}>
      <div><strong>Xem trước dữ liệu đã crawl</strong><span>{item.url}</span></div>
      <button type="button" className="small secondary">{open ? "Thu gọn" : "Xem"}</button>
    </div>
    {open && <div className="preview-body">
      <div className="preview-col">
        {fieldEntries.length > 0 && <div className="preview-section">
          <span className="preview-section-title">Trường dữ liệu ({fieldEntries.length})</span>
          {fieldEntries.map(([key, value]) => <div key={key} className="preview-row"><span>{key}</span><code>{truncate(value)}</code></div>)}
        </div>}
      </div>
      <div className="preview-col">
        <div className="preview-section">
          <span className="preview-section-title">SEO (tự động đọc)</span>
          <div className="preview-row"><span>Title</span><code>{truncate(seo.title)}</code></div>
          <div className="preview-row"><span>Description</span><code>{truncate(seo.description)}</code></div>
          <div className="preview-row"><span>Keywords</span><code>{seo.keywords ? truncate(seo.keywords) : <em>không có trên trang nguồn — sẽ để trống, không tự bịa</em>}</code></div>
        </div>
        {breadcrumb.length > 0 && <div className="preview-section">
          <span className="preview-section-title">Breadcrumb / Category tìm được</span>
          <div className="preview-crumbs">{breadcrumb.map(b => <span key={b.index} className="crumb-chip">{b.text}</span>)}</div>
        </div>}
      </div>
    </div>}
  </div>;
}

// Auto-expanded and auto-scrolled to the newest line while the run is actively crawling (mirrors the
// existing 2.5s state polling, so this is "realtime" the same way the rest of the UI already is — no
// separate live-log transport needed). Collapses back to summary once the run finishes, so completed
// runs don't clutter the screen with a wall of log text.
function LogPanel({ run, live }: { run: CrawlRun; live: boolean }) {
  const preRef = React.useRef<HTMLPreElement>(null);
  const lines = run.logs.slice(-200).map(l => `${l.at} [${l.stage}] ${l.url || ""} ${l.message}${l.error ? ` — ${l.error}` : ""}`).join("\n");
  useEffect(() => { if (live && preRef.current) preRef.current.scrollTop = preRef.current.scrollHeight; }, [live, lines]);
  return <details className="advanced-details" open={live}>
    <summary>Chi tiết kỹ thuật & log{live && <span className="live-dot"> ● đang chạy</span>}</summary>
    <div className="table-scroll"><table><thead><tr><th>Trạng thái</th><th>URL</th><th>Lần chạy</th><th>Lỗi</th></tr></thead><tbody>{run.queue.slice(0, 50).map(q => <tr key={q.id}><td>{q.status}</td><td><code>{q.url}</code></td><td>{q.attempt}</td><td>{q.lastError || "—"}</td></tr>)}</tbody></table></div>
    <pre ref={preRef}>{lines}</pre>
  </details>;
}

// Default/constant values for a column used to live in the Extension ("set it while browsing the
// source site"), but the Extension's job is reading the source site — a fixed value or "now" has
// nothing to do with the page in front of it. Moved here so the Local Tool, which already owns every
// other per-column decision (SEO, assets), owns this one too.
function DefaultValueEditor({ recipe, db, onSaved }: { recipe: CrawlRecipe; db: WorkspaceInfo; onSaved: () => Promise<void> }) {
  const tables = [db.config.mainTable, ...db.config.relatedTables].filter((t): t is string => !!t);
  const [table, setTable] = useState(db.config.mainTable || tables[0] || "");
  const [column, setColumn] = useState("");
  const [mode, setMode] = useState<"constant" | "generated" | "source-url">("constant");
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cols = db.schema.tables.find(t => t.name === table)?.columns || [];
  const defaults = recipe.detail.fields.filter(f => f.source === "constant" || f.source === "generated" || f.source === "source-url");

  async function saveFields(fields: RecipeField[]) {
    const updated: CrawlRecipe = { ...recipe, detail: { ...recipe.detail, fields } };
    const res = await fetch("/api/recipes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updated) });
    const payload = await res.json();
    if (!res.ok || payload.ok === false) throw new Error(payload.error || "Lỗi lưu Recipe");
  }
  async function save() {
    if (!table || !column) return;
    if (mode === "constant" && !value.trim()) { setErr("Nhập giá trị cố định."); return; }
    setBusy(true); setErr("");
    try {
      const newField: RecipeField = mode === "constant"
        ? { id: crypto.randomUUID(), targetTable: table, targetColumn: column, source: "constant", extraction: "constant", attribute: null, selector: null, sampleValue: value.trim() }
        : mode === "generated"
        ? { id: crypto.randomUUID(), targetTable: table, targetColumn: column, source: "generated", extraction: "generated", attribute: null, selector: null, sampleValue: null, generator: null }
        : { id: crypto.randomUUID(), targetTable: table, targetColumn: column, source: "source-url", extraction: "source-url", attribute: null, selector: null, sampleValue: null };
      await saveFields(recipe.detail.fields.filter(f => !(f.targetTable === table && f.targetColumn === column)).concat(newField));
      setValue(""); await onSaved();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }
  async function removeDefault(id: string) {
    setBusy(true); setErr("");
    try { await saveFields(recipe.detail.fields.filter(f => f.id !== id)); await onSaved(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  }

  return <details className="default-values">
    <summary>Giá trị mặc định cho cột {defaults.length > 0 && `(${defaults.length})`}</summary>
    <div className="small" style={{ marginTop: 6 }}>Áp dụng cho mọi sản phẩm crawl bằng Recipe này — không lấy từ website.</div>
    {defaults.length > 0 && <div className="default-value-list">{defaults.map(f => f.source === "source-url"
      ? <SourceUrlDefaultRow key={f.id} field={f} sampleUrl={recipe.list.detailUrlSample} busy={busy}
          onSaveRules={async rules => { setBusy(true); setErr(""); try { await saveFields(recipe.detail.fields.map(x => x.id === f.id ? { ...x, urlRewrite: rules } : x)); await onSaved(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }}
          onRemove={() => removeDefault(f.id)} />
      : <div key={f.id} className="default-value-row"><code>{f.targetTable}.{f.targetColumn}</code><span>{f.source === "generated" ? "Ngày giờ hiện tại" : f.sampleValue}</span><button className="small danger" disabled={busy} onClick={() => removeDefault(f.id)}>Xóa</button></div>
    )}</div>}
    <div className="default-value-form">
      <select value={table} onChange={e => { setTable(e.target.value); setColumn(""); }}>{tables.map(t => <option key={t}>{t}</option>)}</select>
      <select value={column} onChange={e => setColumn(e.target.value)}><option value="">— Chọn cột —</option>{cols.map(c => <option key={c.name}>{c.name}</option>)}</select>
      <div className="mode-toggle">
        <button type="button" className={mode === "constant" ? "primary" : "secondary"} onClick={() => setMode("constant")}>Giá trị cố định</button>
        <button type="button" className={mode === "generated" ? "primary" : "secondary"} onClick={() => setMode("generated")}>Ngày giờ hiện tại</button>
        <button type="button" className={mode === "source-url" ? "primary" : "secondary"} onClick={() => setMode("source-url")}>URL trang đã crawl</button>
      </div>
      {mode === "constant" && <input value={value} onChange={e => setValue(e.target.value)} placeholder="Vd: san-pham, hienthi..." />}
      {mode === "source-url" && <div className="small" style={{ margin: "4px 0" }}>Tự điền đúng URL trang chi tiết mà tool đã crawl cho từng sản phẩm — không cần click gì trên website.</div>}
      {err && <span className="inline-error">{err}</span>}
      <button className="primary" disabled={busy || !table || !column} onClick={save}>Lưu</button>
    </div>
  </details>;
}

// A crawled item's own URL (source-url default) is rarely usable as-is on the new site — a file://
// test path, or the old domain, needs a fixed prefix stripped before it means anything there. Same
// find/replace rule shape as the image UrlRewriteEditor below, but scoped to one field's own rules
// (stored on the RecipeField itself) and tucked behind an "edit" toggle so the common case — no rule
// needed at all — stays a single collapsed line per default.
function SourceUrlDefaultRow({ field, sampleUrl, busy, onSaveRules, onRemove }: { field: RecipeField; sampleUrl: string | null; busy: boolean; onSaveRules: (rules: UrlRewriteRule[]) => Promise<void>; onRemove: () => void }) {
  const [editing, setEditing] = useState(false);
  const rules = field.urlRewrite || [];
  const preview = sampleUrl ? rules.reduce((u, r) => r.find ? u.split(r.find).join(r.replace) : u, sampleUrl) : null;
  function update(i: number, patch: Partial<UrlRewriteRule>) {
    void onSaveRules(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  return <div className="default-value-row-wrap">
    <div className="default-value-row">
      <code>{field.targetTable}.{field.targetColumn}</code>
      <span>URL trang đã crawl{rules.length > 0 ? ` (${rules.length} quy tắc)` : ""}</span>
      <button type="button" className="small secondary" onClick={() => setEditing(!editing)}>{editing ? "Đóng" : "Chỉnh sửa"}</button>
      <button className="small danger" disabled={busy} onClick={onRemove}>Xóa</button>
    </div>
    {editing && <div className="source-url-rules">
      <p className="muted" style={{ margin: "4px 0 8px" }}>Nhập đoạn cần loại bỏ khỏi URL đã crawl (để trống ô "Thay bằng" nếu chỉ muốn xoá).</p>
      {rules.map((r, i) => <div key={i} className="url-rewrite-row">
        <input placeholder="Tìm, vd: file:///home/user/site/" value={r.find} onChange={e => update(i, { find: e.target.value })} />
        <span>→</span>
        <input placeholder="Thay bằng (để trống nếu muốn xoá đoạn đó)" value={r.replace} onChange={e => update(i, { replace: e.target.value })} />
        <button type="button" className="small danger" onClick={() => void onSaveRules(rules.filter((_, idx) => idx !== i))}>Xóa</button>
      </div>)}
      <button type="button" className="small secondary" style={{ marginTop: 6 }} onClick={() => void onSaveRules([...rules, { find: "", replace: "" }])}>+ Thêm quy tắc</button>
      {preview && <div className="url-rewrite-preview"><span>Kết quả:</span><code>{preview}</code></div>}
    </div>}
  </div>;
}

// Every source site structures its thumb/watermark/CDN paths differently — rather than guess more
// patterns server-side, this lets the operator point at one real example URL and describe the fix in
// plain "replace this bit with that" terms, with an immediate before/after preview so they can see the
// rule actually does what they meant before it's used on hundreds of images.
// Picking a real sample used to mean opening devtools, digging through the Network/Elements panel for
// an <img> URL, and pasting it in by hand just to see a rewrite rule's effect. The Tool already knows
// real image URLs by this point (every recipe records the avatar candidates found when it was picked,
// and a completed crawl run's queue carries the actual avatar/gallery URLs read off real product
// pages) — so those are offered as ready-to-pick suggestions and the newest one is pre-selected,
// leaving the operator to type only the "find" half of the rule. Free typing/pasting still works via
// the same input (a <datalist>, not a locked <select>) for a URL the Tool hasn't seen yet.
function UrlRewriteEditor({ rules, onChange, sampleUrls }: { rules: Array<{ find: string; replace: string }>; onChange: (rules: Array<{ find: string; replace: string }>) => void; sampleUrls: string[] }) {
  const [sampleUrl, setSampleUrl] = useState(sampleUrls[0] || "");
  useEffect(() => { if (!sampleUrl && sampleUrls[0]) setSampleUrl(sampleUrls[0]); }, [sampleUrls, sampleUrl]);
  const preview = rules.reduce((url, r) => r.find ? url.split(r.find).join(r.replace) : url, sampleUrl);
  function update(i: number, patch: Partial<{ find: string; replace: string }>) {
    onChange(rules.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  return <div className="mapping-toggle">
    <div>
      <strong>Chỉnh lại đường link ảnh trước khi tải (tuỳ chọn)</strong>
      <p className="muted" style={{ margin: "3px 0 8px" }}>Mỗi web cấu trúc ảnh khác nhau (thumbnail, watermark...). {sampleUrls.length > 0 ? "Đã tự lấy sẵn URL ảnh thật bên dưới để xem trước — chỉ cần nhập đoạn muốn loại bỏ." : "Dán 1 URL ảnh thật vào đây rồi thêm quy tắc thay thế để xem trước kết quả."}</p>
      <input
        list="url-rewrite-sample-urls"
        placeholder="Chọn ảnh có sẵn hoặc dán URL ảnh thật, vd: https://site.com/thumbs/400x400x1/upload/product/x.jpg"
        value={sampleUrl} onChange={e => setSampleUrl(e.target.value)} style={{ marginBottom: 8 }}
      />
      <datalist id="url-rewrite-sample-urls">{sampleUrls.map(u => <option key={u} value={u} />)}</datalist>
      {rules.map((r, i) => <div key={i} className="url-rewrite-row">
        <input placeholder="Tìm, vd: thumbs/400x400x1/" value={r.find} onChange={e => update(i, { find: e.target.value })} />
        <span>→</span>
        <input placeholder="Thay bằng (để trống nếu muốn xoá đoạn đó)" value={r.replace} onChange={e => update(i, { replace: e.target.value })} />
        <button type="button" className="small danger" onClick={() => onChange(rules.filter((_, idx) => idx !== i))}>Xóa</button>
      </div>)}
      <button type="button" className="small secondary" style={{ marginTop: 6 }} onClick={() => onChange([...rules, { find: "", replace: "" }])}>+ Thêm quy tắc</button>
      {sampleUrl && <div className="url-rewrite-preview"><span>Kết quả:</span><code>{preview}</code></div>}
    </div>
  </div>;
}

function ImportReport({ importResult, rollbackBusyId, onRollback }: { importResult: ImportRun; rollbackBusyId: string; onRollback: (run: ImportRun) => Promise<void> }) {
  return <div className="import-report">
    <div className="section-head">
      <span className="small">Import lúc {new Date(importResult.completedAt || importResult.createdAt).toLocaleString("vi-VN")}</span>
      {importResult.rolledBack
        ? <span className="small">✓ Đã xoá dữ liệu này</span>
        : <button className="small danger" disabled={rollbackBusyId === importResult.id} onClick={() => onRollback(importResult)}>{rollbackBusyId === importResult.id ? "Đang xoá…" : "Xoá dữ liệu đã import"}</button>}
    </div>
    <div className="count-row"><CountPill label="Đã ghi mới" value={importResult.inserted} tone="good" /><CountPill label="Đã ghi đè" value={importResult.updated} tone="active" /><CountPill label="Bỏ qua (đã có)" value={importResult.skipped} /><CountPill label="Lỗi" value={importResult.failed} tone={importResult.failed > 0 ? "bad" : "neutral"} /><CountPill label="Tổng dòng SQL" value={importResult.insertedRows} tone="active" /></div>
    {(importResult.assetsDownloaded + importResult.assetsReused + importResult.assetsFailed) > 0 && <div className="count-row"><CountPill label="Ảnh tải mới" value={importResult.assetsDownloaded} tone="good" /><CountPill label="Ảnh trùng (dùng lại)" value={importResult.assetsReused} tone="active" /><CountPill label="Ảnh lỗi" value={importResult.assetsFailed} tone={importResult.assetsFailed > 0 ? "bad" : "neutral"} /></div>}
    {importResult.items.filter(i => i.status === "error").length > 0 && <div className="error-list"><strong>Lỗi khi ghi database</strong>{importResult.items.filter(i => i.status === "error").slice(0, 5).map(i => <div key={i.queueItemId}><code>{i.url}</code><span>{i.error}</span></div>)}</div>}
    {importResult.items.some(i => i.assets.some(a => a.status === "error")) && <div className="error-list"><strong>Lỗi khi tải ảnh</strong>{importResult.items.flatMap(i => i.assets.filter(a => a.status === "error").map(a => <div key={`${i.queueItemId}-${a.sourceUrl}`}><code>{a.sourceUrl}</code><span>{a.error}</span></div>)).slice(0, 5)}</div>}
  </div>;
}

function RunCard({ run, onAction, onDelete, canImport, importBusy, importRuns, rollbackBusyId, onImport, onRollback }: { run: CrawlRun; onAction: (kind: "pause" | "resume" | "retry", id: string) => Promise<void>; onDelete: (id: string) => Promise<void>; canImport: boolean; importBusy: boolean; importRuns: ImportRun[]; rollbackBusyId: string; onImport: (id: string) => Promise<void>; onRollback: (run: ImportRun) => Promise<void> }) {
  const counts = run.queue.reduce((a, q) => { a[q.status] = (a[q.status] || 0) + 1; return a; }, {} as Record<string, number>);
  const failed = run.queue.filter(q => q.status === "failed");
  const doneEnough = run.status === "completed" || run.status === "paused" || run.status === "failed";
  const runError = run.status === "failed" ? [...run.logs].reverse().find(l => l.stage === "run" && l.level === "error")?.error : null;
  const statusLabel = run.status === "completed" ? "Đã hoàn tất" : run.status === "paused" ? "Đang tạm dừng" : run.status === "failed" ? "Lỗi — dừng lại" : "Đang chạy";
  return <div className={`run-card ${run.status === "failed" ? "run-card-failed" : ""}`}>
    <div className="run-top">
      <div><span className="run-kind">{run.mode === "test" ? "TEST 1 ITEM" : "CRAWL TOÀN BỘ"}</span><h3>{statusLabel}</h3></div>
      <div className="run-actions">
        {run.status !== "completed" && run.status !== "paused" && run.status !== "failed" && <button className="secondary" onClick={() => onAction("pause", run.id)}>Tạm dừng</button>}
        {(run.status === "paused" || run.status === "failed") && <button onClick={() => onAction("resume", run.id)}>{run.status === "failed" ? "Thử chạy lại" : "Tiếp tục"}</button>}
        {(counts.failed || 0) > 0 && <button className="danger" onClick={() => onAction("retry", run.id)}>Chạy lại lỗi ({counts.failed})</button>}
        {doneEnough && (counts.success || 0) > 0 && <button className="success-button" disabled={!canImport || importBusy} title={!canImport ? "Cần lưu cấu hình SEO ở bước 5 trước" : ""} onClick={() => onImport(run.id)}>{importBusy ? "Đang đưa vào DB…" : "Đưa vào Database"}</button>}
        {doneEnough && <button className="small danger" onClick={() => onDelete(run.id)}>Xóa</button>}
      </div>
    </div>
    {runError && <div className="error-list"><strong>Run dừng vì lỗi</strong><div><code>{runError}</code></div></div>}
    <div className="count-row">
      <CountPill label="Trang" value={run.discoveredPages} />
      <CountPill label="Chờ" value={counts.pending || 0} />
      <CountPill label="Đang chạy" value={counts.running || 0} tone="active" />
      <CountPill label="Thành công" value={counts.success || 0} tone="good" />
      <CountPill label="Lỗi" value={counts.failed || 0} tone={(counts.failed || 0) > 0 ? "bad" : "neutral"} />
    </div>
    {failed.length > 0 && <div className="error-list"><strong>Cần xử lý</strong>{failed.slice(0, 5).map(q => <div key={q.id}><code>{q.url}</code><span>{q.lastError || "Không rõ lỗi"}</span></div>)}</div>}
    {(() => { const sample = run.queue.find(q => q.status === "success" && q.extracted); return sample ? <ExtractedPreview item={sample} /> : null; })()}
    {importRuns.filter(r => r.runId === run.id).map(r => <ImportReport key={r.id} importResult={r} rollbackBusyId={rollbackBusyId} onRollback={onRollback} />)}
    <LogPanel run={run} live={run.status === "running" || run.status === "discovering"} />
  </div>;
}

function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [state, setState] = useState<Phase0State>(EMPTY);
  const [sqlFile, setSqlFile] = useState<File | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [browse, setBrowse] = useState<TableRowsResult | null>(null);
  const [exportInfo, setExportInfo] = useState<{ fileName: string; downloadUrl: string; sha256: string } | null>(null);
  const [sourceTable, setSourceTable] = useState("");
  const [sourceColumn, setSourceColumn] = useState("");
  const [targetTable, setTargetTable] = useState("");
  const [targetColumn, setTargetColumn] = useState("");
  const [crawl, setCrawl] = useState<CrawlRuntimeState>({ activeRunId: null, runs: [] });
  const [crawlWorkers, setCrawlWorkers] = useState(4);
  const [seoTable, setSeoTable] = useState("");
  const [seoCustomizing, setSeoCustomizing] = useState(false);
  const [seoParentColumn, setSeoParentColumn] = useState("");
  const [seoComColumn, setSeoComColumn] = useState("");
  const [seoActColumn, setSeoActColumn] = useState("");
  const [seoTypeColumn, setSeoTypeColumn] = useState("");
  const [seoTitleColumn, setSeoTitleColumn] = useState("");
  const [seoDescColumn, setSeoDescColumn] = useState("");
  const [seoKeywordsColumn, setSeoKeywordsColumn] = useState("");
  const [seoComValue, setSeoComValue] = useState("");
  const [seoActValue, setSeoActValue] = useState("man");
  const [seoTypeValue, setSeoTypeValue] = useState("");
  const [existingEnabled, setExistingEnabled] = useState(true);
  const [matchColumns, setMatchColumns] = useState<string[]>([]);
  const [avatarEnabled, setAvatarEnabled] = useState(false);
  const [avatarColumn, setAvatarColumn] = useState("");
  const [galleryEnabled, setGalleryEnabled] = useState(false);
  const [galleryTable, setGalleryTable] = useState("");
  const [galleryParentColumn, setGalleryParentColumn] = useState("");
  const [galleryPathColumn, setGalleryPathColumn] = useState("");
  const [urlRewriteRules, setUrlRewriteRules] = useState<Array<{ find: string; replace: string }>>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportBundle, setExportBundle] = useState<ExportBundleResult | null>(null);
  const [importBusyId, setImportBusyId] = useState("");
  const [importRuns, setImportRuns] = useState<ImportRun[]>([]);
  const [rollbackBusyId, setRollbackBusyId] = useState("");
  const [conflictReview, setConflictReview] = useState<{ crawlRunId: string; conflicts: ImportConflict[]; decisions: Record<string, ImportDecision> } | null>(null);
  const [mappingSaved, setMappingSaved] = useState(false);

  async function refresh() { try { const [h, s, c, im] = await Promise.all([fetch("/api/health"), fetch("/api/state"), fetch("/api/crawl"), fetch("/api/import")]); setHealth(await h.json()); setState(await s.json()); const cp = await c.json(); if (cp.runtime) setCrawl(cp.runtime); const ip = await im.json(); if (ip.runs) setImportRuns(ip.runs); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  useEffect(() => { refresh(); const timer = window.setInterval(refresh, 2500); return () => window.clearInterval(timer); }, []);
  const db = state.database;

  async function call(url: string, init?: RequestInit) { const response = await fetch(url, init); const payload = await response.json(); if (!response.ok || payload.ok === false) throw new Error(payload.error || "Request failed"); return payload; }
  async function importSql() {
    if (!sqlFile) return;
    if (db) {
      const proceed = window.confirm(
        `Bạn đang có workspace từ "${db.originalName}" (database ${db.database}).\n\n` +
        `Import file SQL mới sẽ tạo một database RỖNG khác — Tool sẽ không còn hiển thị dữ liệu đã crawl/import của workspace hiện tại nữa ` +
        `(dữ liệu cũ không bị xoá dưới MariaDB, chỉ là Tool không còn trỏ tới nó).\n\n` +
        `Bạn có chắc chắn muốn tiếp tục?`
      );
      if (!proceed) return;
    }
    setBusy("import"); setError(""); setExportInfo(null);
    try { const body = new FormData(); body.append("file", sqlFile); await call(`/api/sql/import${db ? "?confirm=1" : ""}`, { method: "POST", body }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  async function browseTable(table: string, offset = 0) { setBusy(`browse:${table}`); setError(""); try { const p = await call(`/api/workspace/table/${encodeURIComponent(table)}/rows?offset=${offset}&limit=25`); setBrowse(p.result); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  async function saveConfig(next: Partial<WorkspaceConfig>) { if (!db) return; setBusy("config"); setError(""); try { await call("/api/workspace/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...db.config, ...next }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  async function reset() { setBusy("reset"); setError(""); try { await call("/api/workspace/reset", { method: "POST" }); setBrowse(null); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  async function exportSql() { setBusy("export"); setError(""); try { const p = await call("/api/workspace/export", { method: "POST" }); setExportInfo(p.result); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }

  const selectedTables = useMemo(() => db?.config.mainTable ? [db.config.mainTable, ...db.config.relatedTables] : [], [db?.config.mainTable, db?.config.relatedTables]);
  const sourceSchema = db?.schema.tables.find(t => t.name === sourceTable);
  const targetSchema = db?.schema.tables.find(t => t.name === targetTable);
  const autoSuggestion = useMemo(() => db?.schema.relations.find(r => r.sourceTable === sourceTable && r.sourceColumn === sourceColumn && selectedTables.includes(r.targetTable)), [db?.schema.relations, sourceTable, sourceColumn, selectedTables]);

  useEffect(() => {
    if (!db?.config.mainTable) { setSourceTable(""); setTargetTable(""); return; }
    if (!selectedTables.includes(sourceTable)) setSourceTable(db.config.mainTable);
    if (!selectedTables.includes(targetTable) || targetTable === (selectedTables.includes(sourceTable) ? sourceTable : db.config.mainTable)) setTargetTable(selectedTables.find(t => t !== (selectedTables.includes(sourceTable) ? sourceTable : db.config.mainTable)) || "");
  }, [db?.config.mainTable, selectedTables.join("|")]);
  useEffect(() => { const cols = db?.schema.tables.find(t => t.name === sourceTable)?.columns || []; if (!cols.some(c => c.name === sourceColumn)) setSourceColumn(cols.find(c => c.name.startsWith("id_"))?.name || cols[0]?.name || ""); }, [sourceTable, db?.schema.tables]);
  useEffect(() => { const cols = db?.schema.tables.find(t => t.name === targetTable)?.columns || []; if (!cols.some(c => c.name === targetColumn)) setTargetColumn(cols.find(c => c.name === "id")?.name || cols[0]?.name || ""); }, [targetTable, db?.schema.tables]);

  function applySuggestion() { if (!autoSuggestion) return; setTargetTable(autoSuggestion.targetTable); setTargetColumn(autoSuggestion.targetColumn); }
  async function addRelation() {
    if (!db || !sourceTable || !sourceColumn || !targetTable || !targetColumn || sourceTable === targetTable) return;
    const duplicate = db.config.relations.some(r => r.sourceTable === sourceTable && r.sourceColumn === sourceColumn && r.targetTable === targetTable && r.targetColumn === targetColumn);
    if (duplicate) { setError("Quan hệ này đã tồn tại."); return; }
    const relation: RelationSuggestion = { id: `manual_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, sourceTable, sourceColumn, targetTable, targetColumn, confidence: 1, reason: "User defined relation", status: "confirmed" };
    await saveConfig({ relations: [...db.config.relations, relation] });
  }
  async function removeRelation(id: string) { if (!db) return; setBusy(`relation:${id}`); try { await call(`/api/workspace/relations/${encodeURIComponent(id)}`, { method: "DELETE" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  async function startCrawl(recipeId: string, mode: "test" | "full") { setBusy("crawl"); setError(""); try { await call("/api/crawl/start", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipeId, mode, workers: crawlWorkers }) }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  async function runAction(kind: "pause" | "resume" | "retry", id: string) { try { await call(`/api/crawl/${encodeURIComponent(id)}/${kind}`, { method: "POST" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } }
  async function deleteCrawlRunAction(id: string) { if (!confirm("Xóa lần chạy này? Không thể hoàn tác.")) return; setBusy(`delete-run:${id}`); setError(""); try { await call(`/api/crawl/${encodeURIComponent(id)}`, { method: "DELETE" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  // A Recipe's id embeds its hostname (see freshRecipe() in content.ts) — for a file:// test page that
  // "hostname" is a filesystem folder path full of literal "/" characters, which breaks completely
  // unencoded in a URL path segment (the router splits on "/", so only the piece before the first
  // slash ever reaches :id — the rest 404s as "not found"). Every id interpolated into a path needs
  // this, not just recipe ids, since nothing stops a future id format from doing the same.
  async function deleteRecipeAction(id: string) { if (!confirm("Xóa cấu hình crawl (Recipe) này? Không thể hoàn tác.")) return; setBusy(`delete-recipe:${id}`); setError(""); try { await call(`/api/recipes/${encodeURIComponent(id)}`, { method: "DELETE" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }
  async function clearWorkspace() { if (!confirm("Đổi sang SQL khác? Database MariaDB hiện tại vẫn còn nguyên (không bị xóa), chỉ ẩn khỏi màn hình này — bạn có thể import lại SQL khác hoặc import lại cùng file.")) return; setBusy("clear-workspace"); setError(""); setBrowse(null); setExportInfo(null); try { await call("/api/workspace", { method: "DELETE" }); await refresh(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); } }

  const seoSchema = db?.schema.tables.find(t => t.name === seoTable);
  const mainSchemaForMapping = db?.schema.tables.find(t => t.name === db?.config.mainTable);
  // A match column that no recipe ever writes a value into can never match an existing row — the
  // "skip if already exists" check for it is always false, so the safety feature quietly stops working
  // and every re-import inserts a fresh duplicate set instead of skipping/updating. Restricting the
  // picker (and the auto-suggestion below) to columns some recipe actually populates — plus auto-slug
  // columns, which the import engine fills in on its own — keeps a column like this from being pickable
  // in the first place.
  const populatedMainColumns = useMemo(() => {
    if (!db?.config.mainTable) return new Set<string>();
    const set = new Set<string>();
    for (const r of state.recipes) for (const f of r.detail.fields) if (f.targetTable === db.config.mainTable) set.add(f.targetColumn);
    for (const c of mainSchemaForMapping?.columns || []) if (/slug/i.test(c.name)) set.add(c.name);
    return set;
  }, [db?.config.mainTable, state.recipes, mainSchemaForMapping]);
  // Real image URLs the Tool already has on hand, newest first: a completed crawl run's actual
  // avatar/gallery URLs (read off real product pages) ahead of the recipe's own picked-avatar
  // candidates (recorded once, while building the recipe) — offered so configuring the rewrite rule
  // below never requires opening devtools to go find a URL by hand.
  const imageSampleUrls = useMemo(() => {
    const urls: string[] = [];
    for (const run of crawl.runs) {
      for (const q of run.queue) {
        if (q.status !== "success" || !q.extracted) continue;
        urls.push(...q.avatarCandidates, ...q.extracted.galleryCandidates);
        // Images embedded inside an HTML content/description field (not the dedicated avatar/gallery
        // picks) are a separate source entirely — a "thumbs/..." pattern used only inline in article
        // bodies would otherwise never show up as a suggestion here.
        for (const value of Object.values(q.extracted.fields)) {
          if (!value || !/<img/i.test(value)) continue;
          for (const m of value.matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) {
            try { urls.push(new URL(m[1]!, q.url).href); } catch {}
          }
        }
      }
    }
    for (const r of state.recipes) urls.push(...r.list.imageCandidates.map(c => c.url));
    return [...new Set(urls)].slice(0, 30);
  }, [crawl.runs, state.recipes]);
  function guessColumn(table: SchemaTable | undefined, patterns: RegExp[]): string {
    if (!table) return "";
    for (const p of patterns) { const hit = table.columns.find(c => p.test(c.name)); if (hit) return hit.name; }
    return "";
  }
  useEffect(() => {
    if (!db?.config.mainTable) return;
    const cfgSeo = db.config.seo;
    if (cfgSeo) {
      setSeoTable(cfgSeo.seoTable); setSeoParentColumn(cfgSeo.parentColumn); setSeoComColumn(cfgSeo.comColumn); setSeoActColumn(cfgSeo.actColumn); setSeoTypeColumn(cfgSeo.typeColumn);
      setSeoTitleColumn(cfgSeo.titleColumn || ""); setSeoDescColumn(cfgSeo.descriptionColumn || ""); setSeoKeywordsColumn(cfgSeo.keywordsColumn || "");
      setSeoComValue(cfgSeo.com); setSeoActValue(cfgSeo.act); setSeoTypeValue(cfgSeo.type);
    } else if (!seoTable) {
      const guessTable = db.schema.tables.find(t => /seo/i.test(t.name));
      if (guessTable) setSeoTable(guessTable.name);
      setSeoComValue(db.config.mainTable.replace(/^.*?_/, ""));
    }
    if (db.config.existingRecord) { setExistingEnabled(true); setMatchColumns(db.config.existingRecord.matchColumns); }
    else if (!matchColumns.length) {
      const slugCol = mainSchemaForMapping?.columns.find(c => /slug/i.test(c.name) && populatedMainColumns.has(c.name))?.name;
      const nameCol = mainSchemaForMapping?.columns.find(c => /^name/i.test(c.name) && populatedMainColumns.has(c.name))?.name;
      setMatchColumns([slugCol, nameCol].filter((x): x is string => !!x));
    }
    if (db.config.assets?.urlRewrite?.length) setUrlRewriteRules(db.config.assets.urlRewrite);
    if (db.config.assets?.avatarColumn) { setAvatarEnabled(true); setAvatarColumn(db.config.assets.avatarColumn.column); }
    else if (!avatarColumn) { const photoCol = mainSchemaForMapping?.columns.find(c => /photo|avatar|thumb|image/i.test(c.name))?.name; if (photoCol) setAvatarColumn(photoCol); }
    if (db.config.assets?.galleryTable) {
      setGalleryEnabled(true); setGalleryTable(db.config.assets.galleryTable.table);
      setGalleryParentColumn(db.config.assets.galleryTable.parentColumn); setGalleryPathColumn(db.config.assets.galleryTable.pathColumn);
    } else if (!galleryTable) {
      const guessTable = db.schema.tables.find(t => /gallery|album|image/i.test(t.name) && t.name !== db.config.mainTable);
      if (guessTable) setGalleryTable(guessTable.name);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db?.config.mainTable]);
  const galleryTableSchema = db?.schema.tables.find(t => t.name === galleryTable);
  useEffect(() => {
    if (!galleryTableSchema) return;
    if (!galleryParentColumn) setGalleryParentColumn(guessColumn(galleryTableSchema, [/^id_parent$/i, /parent/i]));
    if (!galleryPathColumn) setGalleryPathColumn(guessColumn(galleryTableSchema, [/photo|path|image|url/i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [galleryTable]);
  useEffect(() => {
    if (!seoSchema) return;
    if (!seoComColumn) setSeoComColumn(guessColumn(seoSchema, [/^com$/i]));
    if (!seoActColumn) setSeoActColumn(guessColumn(seoSchema, [/^act$/i]));
    if (!seoTypeColumn) setSeoTypeColumn(guessColumn(seoSchema, [/^type$/i]));
    if (!seoParentColumn) setSeoParentColumn(guessColumn(seoSchema, [/^id_parent$/i, /parent/i]));
    if (!seoTitleColumn) setSeoTitleColumn(guessColumn(seoSchema, [/title/i]));
    if (!seoDescColumn) setSeoDescColumn(guessColumn(seoSchema, [/description/i]));
    if (!seoKeywordsColumn) setSeoKeywordsColumn(guessColumn(seoSchema, [/keyword/i]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seoTable]);

  async function saveMapping() {
    if (!db || !seoTable) return;
    setBusy("mapping"); setError(""); setMappingSaved(false);
    try {
      const seo: SeoMappingConfig = { seoTable, parentColumn: seoParentColumn, comColumn: seoComColumn, actColumn: seoActColumn, typeColumn: seoTypeColumn, titleColumn: seoTitleColumn || null, descriptionColumn: seoDescColumn || null, keywordsColumn: seoKeywordsColumn || null, com: seoComValue, act: seoActValue, type: seoTypeValue };
      const existingRecord: ExistingRecordPolicy | null = existingEnabled && matchColumns.length ? { matchColumns, policy: "skip" } : null;
      const assets: AssetMappingConfig = {
        avatarColumn: avatarEnabled && avatarColumn && db.config.mainTable ? { table: db.config.mainTable, column: avatarColumn } : null,
        galleryTable: galleryEnabled && galleryTable && galleryParentColumn && galleryPathColumn ? { table: galleryTable, parentColumn: galleryParentColumn, pathColumn: galleryPathColumn } : null,
        urlRewrite: urlRewriteRules.filter(r => r.find)
      };
      await saveConfig({ seo, existingRecord, assets });
      setMappingSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(""); }
  }
  // "Đưa vào Database" previews first — if nothing collides with an existing row (the common case:
  // all-new items), it goes straight to the real write, same one click as before. Only when there's
  // something to review does the conflict list appear, FileZilla-style: default action is Skip per
  // item, reviewable/overridable individually or in bulk, nothing is written until confirmed.
  async function runImport(crawlRunId: string) {
    setImportBusyId(crawlRunId); setError("");
    try {
      const preview = await call(`/api/import/preview/${encodeURIComponent(crawlRunId)}`, { method: "POST" });
      if (preview.result.conflicts.length === 0) {
        await call(`/api/import/from-crawl/${encodeURIComponent(crawlRunId)}`, { method: "POST" });
        await refresh();
      } else {
        const decisions: Record<string, ImportDecision> = {};
        for (const c of preview.result.conflicts as ImportConflict[]) decisions[c.queueItemId] = "skip";
        setConflictReview({ crawlRunId, conflicts: preview.result.conflicts, decisions });
      }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setImportBusyId(""); }
  }
  async function confirmImport() {
    if (!conflictReview) return;
    setImportBusyId(conflictReview.crawlRunId); setError("");
    try {
      await call(`/api/import/from-crawl/${encodeURIComponent(conflictReview.crawlRunId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decisions: conflictReview.decisions }) });
      setConflictReview(null); await refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setImportBusyId(""); }
  }
  // Deletes exactly the rows one Import run wrote (using the server's own delta log as the source of
  // truth — see rollbackImportRun in mapping.ts) — the fix for the recurring real case where a
  // workspace got re-imported a few times while dedup was being set up correctly, leaving duplicate
  // rows behind with no way to remove just those without touching the database by hand.
  async function rollbackImportAction(run: ImportRun) {
    if (!confirm(`Xoá toàn bộ dữ liệu đã ghi bởi lần import này (${run.inserted} bản ghi mới)? Không thể hoàn tác.`)) return;
    setRollbackBusyId(run.id); setError("");
    try { await call(`/api/import/${encodeURIComponent(run.id)}/rollback`, { method: "POST" }); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setRollbackBusyId(""); }
  }
  async function runExport() {
    setExportBusy(true); setError("");
    try { const p = await call("/api/export/bundle", { method: "POST" }); setExportBundle(p.result); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setExportBusy(false); }
  }

  const recipeReady = (id: string) => crawl.runs.some(x => x.recipeId === id && x.mode === "test" && x.status === "completed" && x.queue.some(q => q.status === "success"));
  const step = !db ? 1 : !db.config.mainTable ? 2 : state.recipes.length === 0 ? 3 : !state.recipes.some(r => recipeReady(r.id)) ? 4 : 5;
  // Steps behind the current one collapse to a one-line summary — the operator's attention should be on
  // the step they're actually working on, not scrolling past finished setup to reach it. "Sửa" opens a
  // finished step back up without losing anything (nothing here is destroyed, just hidden); toggled per
  // step number so re-opening step 1 doesn't also re-open step 2.
  const [forceOpenSteps, setForceOpenSteps] = useState<Set<number>>(new Set());
  const isStepCollapsed = (n: number) => n < step && !forceOpenSteps.has(n);
  const toggleForceOpen = (n: number) => setForceOpenSteps(prev => { const next = new Set(prev); if (next.has(n)) next.delete(n); else next.add(n); return next; });

  return <main className="shell simple-shell">
    <header className="simple-hero">
      <div><p className="eyebrow">CRAWL DATA WEB</p><h1>Di chuyển dữ liệu website</h1><p className="muted">Làm lần lượt từ trên xuống. Phần kỹ thuật được ẩn đi, chỉ mở khi cần kiểm tra lỗi.</p></div>
      <div className="status-stack"><Badge ok={health?.ok === true}>Ứng dụng {health?.ok ? "sẵn sàng" : "mất kết nối"}</Badge><Badge ok={health?.mariadb.ok === true}>Database {health?.mariadb.ok ? "sẵn sàng" : "chưa sẵn sàng"}</Badge><ThemeToggle /></div>
    </header>

    <div className="stepbar">
      {["SQL", "Chọn bảng", "Dạy crawler", "Test 1 mẫu", "Crawl toàn bộ"].map((name, i) => <div key={name} className={`step ${step === i + 1 ? "current" : step > i + 1 ? "done" : ""}`}><span>{step > i + 1 ? "✓" : i + 1}</span><b>{name}</b></div>)}
    </div>
    {error && <div className="alert"><strong>Có lỗi cần xử lý</strong><span>{error}</span></div>}

    <section className={`flow-card ${step === 1 ? "focus" : ""}`}>
      <div className="flow-title"><span className="flow-number">1</span><div><h2>Chọn file SQL của website mới</h2><p>Chỉ cần chọn file và bấm Import. File gốc không bị sửa.</p></div>{db && <Badge ok={true}>Đã xong</Badge>}{db && isStepCollapsed(1) && <button type="button" className="small secondary" onClick={() => toggleForceOpen(1)}>Sửa</button>}</div>
      {isStepCollapsed(1) && db
        ? <div className="auto-summary"><span>Đã import <code>{db.originalName}</code> · {db.schema.tables.length} bảng · DB: <code>{db.database}</code></span></div>
        : <>
      {!db ? <div className="upload-box"><input type="file" accept=".sql" onChange={e => setSqlFile(e.target.files?.[0] || null)} /><button className="primary-large" disabled={!sqlFile || !!busy || !health?.mariadb.ok} onClick={importSql}>{busy === "import" ? "Đang import…" : "Import SQL"}</button></div> : <div className="success-line">
        <div>
          <div><strong>{db.originalName}</strong><span>{db.schema.tables.length} bảng đã đọc</span></div>
          {/* Every workspace shows the same original filename, so this is the only thing that actually
              tells apart "the database I'm looking at in phpMyAdmin" from "the one the Tool is using
              right now" — each Import SQL provisions a brand-new, differently-named database. */}
          <div className="db-name-line">Database MariaDB đang dùng: <code>{db.database}</code></div>
        </div>
        <button className="small secondary" disabled={!!busy} onClick={clearWorkspace}>Đổi sang SQL khác</button>
      </div>}
      {db && forceOpenSteps.has(1) && step > 1 && <button type="button" className="small secondary" style={{ marginTop: 10 }} onClick={() => toggleForceOpen(1)}>Xong, thu gọn lại</button>}
      </>}
    </section>

    {db && <section className={`flow-card ${step === 2 ? "focus" : ""}`}>
      <div className="flow-title"><span className="flow-number">2</span><div><h2>Chọn dữ liệu sẽ đưa vào</h2><p>Chọn bảng chính trước. Bảng phụ chỉ chọn khi sản phẩm/bài viết có liên quan tới bảng đó.</p></div>{db.config.mainTable && <Badge ok={true}>Đã chọn</Badge>}{db.config.mainTable && isStepCollapsed(2) && <button type="button" className="small secondary" onClick={() => toggleForceOpen(2)}>Sửa</button>}</div>
      {isStepCollapsed(2)
        ? <div className="auto-summary"><span>Bảng chính: <code>{db.config.mainTable}</code>{db.config.relatedTables.length ? ` · ${db.config.relatedTables.length} bảng phụ` : ""}</span></div>
        : <>
      <SubSection title="Bảng chính & bảng phụ">
        <div className="simple-grid">
          <label className="choice-box"><span>Bảng chính</span><select value={db.config.mainTable || ""} onChange={e => { const nextMain = e.target.value || null; const nextRelated = db.config.relatedTables.filter(t => t !== nextMain); const allowed = new Set(nextMain ? [nextMain, ...nextRelated] : nextRelated); saveConfig({ mainTable: nextMain, relatedTables: nextRelated, relations: db.config.relations.filter(r => allowed.has(r.sourceTable) && allowed.has(r.targetTable)) }); }}><option value="">— Chọn bảng chính —</option>{db.schema.tables.map(t => <option key={t.name}>{t.name}</option>)}</select><small>Ví dụ: bmws_product hoặc bmws_news</small></label>
          <div className="choice-box"><span>Bảng phụ</span>{!db.config.mainTable ? <small>Chọn bảng chính trước.</small> : <div className="chip-list">{db.schema.tables.filter(t => t.name !== db.config.mainTable).map(t => <label key={t.name} className={db.config.relatedTables.includes(t.name) ? "selected" : ""}><input type="checkbox" checked={db.config.relatedTables.includes(t.name)} onChange={e => { const next = e.target.checked ? [...db.config.relatedTables, t.name] : db.config.relatedTables.filter(x => x !== t.name); const allowed = new Set([db.config.mainTable!, ...next]); saveConfig({ relatedTables: next, relations: db.config.relations.filter(r => allowed.has(r.sourceTable) && allowed.has(r.targetTable)) }); }} /><span>{t.name}</span></label>)}</div>}</div>
        </div>
      </SubSection>

      {selectedTables.length > 1 && <SubSection title="Quan hệ giữa các bảng" hint="Ví dụ: product.id_list → product_list.id. Nếu không cần bảng phụ thì có thể bỏ qua.">
        <details className="relation-simple"><summary>Thiết lập liên kết <b>({db.config.relations.length})</b></summary><div className="relation-builder"><div className="relation-side"><span className="side-title">Từ cột</span><select value={sourceTable} onChange={e => setSourceTable(e.target.value)}>{selectedTables.map(t => <option key={t}>{t}</option>)}</select><select value={sourceColumn} onChange={e => setSourceColumn(e.target.value)}>{(sourceSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></div><div className="relation-arrow">→</div><div className="relation-side"><span className="side-title">Sang cột</span><select value={targetTable} onChange={e => setTargetTable(e.target.value)}>{selectedTables.filter(t => t !== sourceTable).map(t => <option key={t}>{t}</option>)}</select><select value={targetColumn} onChange={e => setTargetColumn(e.target.value)}>{(targetSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></div><button disabled={!!busy || !targetTable} onClick={addRelation}>Thêm liên kết</button></div>{autoSuggestion && <div className="suggestion-hint"><div><strong>Hệ thống gợi ý:</strong> <code>{autoSuggestion.sourceTable}.{autoSuggestion.sourceColumn}</code> → <code>{autoSuggestion.targetTable}.{autoSuggestion.targetColumn}</code></div><button className="small secondary" onClick={applySuggestion}>Dùng gợi ý</button></div>}<div className="confirmed-relations">{db.config.relations.map((r, i) => <div className="confirmed-relation" key={r.id}><span className="relation-number">{i + 1}</span><div><strong>{r.sourceTable}.{r.sourceColumn}</strong><span>→</span><strong>{r.targetTable}.{r.targetColumn}</strong></div><button className="small danger" onClick={() => removeRelation(r.id)}>Xóa</button></div>)}</div></details>
      </SubSection>}
      {forceOpenSteps.has(2) && step > 2 && <button type="button" className="small secondary" style={{ marginTop: 14 }} onClick={() => toggleForceOpen(2)}>Xong, thu gọn lại</button>}
      </>}
    </section>}

    <section className={`flow-card ${step === 3 ? "focus" : ""}`}>
      <div className="flow-title"><span className="flow-number">3</span><div><h2>Dạy crawler bằng Chrome Extension</h2><p>Trên website cũ, chỉ cần chọn: khối item → link chi tiết → ảnh → nội dung → phân trang. SEO tự lấy.</p></div>{state.recipes.length > 0 && <Badge ok={true}>{state.recipes.length} cấu hình</Badge>}{state.recipes.length > 0 && isStepCollapsed(3) && <button type="button" className="small secondary" onClick={() => toggleForceOpen(3)}>Sửa</button>}</div>
      {isStepCollapsed(3)
        ? <div className="auto-summary"><span>{state.recipes.length} cấu hình crawl đã lưu</span></div>
        : <>
      {state.recipes.length === 0 ? <div className="instruction"><strong>Chưa có cấu hình crawl.</strong><span>Mở website nguồn bằng Chrome, bật Extension và làm theo từng bước trên panel.</span></div> : <div className="recipe-list">{state.recipes.map(r => <div className="recipe-row-wrap" key={r.id}>
        <div className="recipe-row"><div><strong>{r.name}</strong><span>{r.hostname}{r.source.listPath}</span></div><div className="recipe-tags"><span>{r.detail.fields.length} trường chi tiết</span><span>{r.list.pagination.kind === "none" ? "1 trang / không paging" : "Có phân trang"}</span><span>SEO tự động</span><button className="small danger" disabled={!!busy} onClick={() => deleteRecipeAction(r.id)}>Xóa</button></div></div>
        {db && <DefaultValueEditor recipe={r} db={db} onSaved={refresh} />}
      </div>)}</div>}
      {forceOpenSteps.has(3) && step > 3 && <button type="button" className="small secondary" style={{ marginTop: 14 }} onClick={() => toggleForceOpen(3)}>Xong, thu gọn lại</button>}
      </>}
    </section>

    <section className={`flow-card ${step === 4 || step === 5 ? "focus" : ""}`}>
      <div className="flow-title"><span className="flow-number">4</span><div><h2>Chạy thử 1 item rồi mới crawl toàn bộ</h2><p>Đây là màn hình bạn sẽ dùng nhiều nhất. Nếu test thành công, nút Crawl toàn bộ tự mở.</p></div><label className="worker-control"><span>Workers</span><select value={crawlWorkers} onChange={e => setCrawlWorkers(Number(e.target.value))}>{[1,2,3,4,5,6,7,8].map(n => <option key={n} value={n}>{n}{n === 4 ? " — khuyên dùng" : ""}</option>)}</select></label></div>
      {state.recipes.length === 0 ? <div className="instruction"><strong>Chưa thể test.</strong><span>Hãy hoàn thành bước 3 trước.</span></div> : <div className="crawl-recipes">{state.recipes.map(r => { const passed = recipeReady(r.id); return <div className="crawl-recipe" key={r.id}><div className="crawl-recipe-info"><strong>{r.name}</strong><span>{r.hostname}{r.source.listPath}</span></div><div className="crawl-cta"><button className={passed ? "secondary" : "primary-large"} disabled={!!busy} onClick={() => startCrawl(r.id, "test")}>{passed ? "Test lại 1 item" : "Test 1 item"}</button><button className="success-button" disabled={!!busy || !passed} onClick={() => startCrawl(r.id, "full")}>{passed ? "Crawl toàn bộ" : "Crawl toàn bộ — cần Test trước"}</button></div>{passed && <div className="test-passed">✓ Test thành công — có thể chạy toàn bộ</div>}</div>; })}</div>}
      <div className="runs-stack">{crawl.runs.slice().reverse().slice(0, 5).map(run => <RunCard key={run.id} run={run} onAction={runAction} onDelete={deleteCrawlRunAction} canImport={!!db?.config.seo} importBusy={importBusyId === run.id} importRuns={importRuns} rollbackBusyId={rollbackBusyId} onImport={runImport} onRollback={rollbackImportAction} />)}</div>
    </section>

    {db?.config.mainTable && <section className="flow-card">
      <div className="flow-title"><span className="flow-number">5</span><div><h2>Cấu hình SEO, ảnh &amp; bản ghi đã tồn tại</h2><p>Bắt buộc trước khi đưa dữ liệu vào Database — dữ liệu SEO gốc luôn được ưu tiên, không tự bịa keyword.</p></div>{db.config.seo && <Badge ok={true}>Đã lưu</Badge>}</div>
      <SubSection title="Cấu hình SEO">
        {seoTable && !seoCustomizing
          ? <div className="auto-summary">
              <span>SEO: tự động ánh xạ vào bảng <code>{seoTable}</code> ({[seoParentColumn, seoComColumn, seoActColumn, seoTypeColumn, seoTitleColumn, seoDescColumn, seoKeywordsColumn].filter(Boolean).length} trường)</span>
              <button type="button" className="small secondary" onClick={() => setSeoCustomizing(true)}>Tuỳ chỉnh lại</button>
            </div>
          : <>
              <div className="mapping-grid">
                <label>Bảng SEO<select value={seoTable} onChange={e => { setSeoTable(e.target.value); setSeoComColumn(""); setSeoActColumn(""); setSeoTypeColumn(""); setSeoParentColumn(""); setSeoTitleColumn(""); setSeoDescColumn(""); setSeoKeywordsColumn(""); }}><option value="">— Chọn bảng —</option>{db.schema.tables.filter(t => t.name !== db.config.mainTable).map(t => <option key={t.name}>{t.name}</option>)}</select></label>
                <label>Cột id_parent<select value={seoParentColumn} onChange={e => setSeoParentColumn(e.target.value)}><option value="">—</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
                <label>Cột com<select value={seoComColumn} onChange={e => setSeoComColumn(e.target.value)}><option value="">—</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
                <label>Cột act<select value={seoActColumn} onChange={e => setSeoActColumn(e.target.value)}><option value="">—</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
                <label>Cột type<select value={seoTypeColumn} onChange={e => setSeoTypeColumn(e.target.value)}><option value="">—</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
                <label>Giá trị com<input type="text" value={seoComValue} onChange={e => setSeoComValue(e.target.value)} placeholder="vd: product" /></label>
                <label>Giá trị act<input type="text" value={seoActValue} onChange={e => setSeoActValue(e.target.value)} placeholder="vd: man" /></label>
                <label>Giá trị type<input type="text" value={seoTypeValue} onChange={e => setSeoTypeValue(e.target.value)} placeholder="vd: san-pham" /></label>
                <label>Cột title (tuỳ chọn)<select value={seoTitleColumn} onChange={e => setSeoTitleColumn(e.target.value)}><option value="">— Không dùng —</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
                <label>Cột description (tuỳ chọn)<select value={seoDescColumn} onChange={e => setSeoDescColumn(e.target.value)}><option value="">— Không dùng —</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
                <label>Cột keywords (tuỳ chọn)<select value={seoKeywordsColumn} onChange={e => setSeoKeywordsColumn(e.target.value)}><option value="">— Không dùng —</option>{(seoSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
              </div>
              {seoTable && <button type="button" className="small secondary" style={{ marginTop: 10 }} onClick={() => setSeoCustomizing(false)}>Xong, thu gọn lại</button>}
            </>}
      </SubSection>

      <SubSection title="Ảnh sản phẩm">
        <div className="mapping-toggle"><input type="checkbox" checked={avatarEnabled} onChange={e => setAvatarEnabled(e.target.checked)} /><div><strong>Tải ảnh đại diện (avatar) về máy</strong><p className="muted" style={{ margin: "3px 0 6px" }}>Cột trên bảng chính sẽ nhận tên file ảnh đã tải (thay vì URL nguồn).</p>{avatarEnabled && <select value={avatarColumn} onChange={e => setAvatarColumn(e.target.value)}><option value="">— Chọn cột —</option>{(mainSchemaForMapping?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select>}</div></div>
        <div className="mapping-toggle"><input type="checkbox" checked={galleryEnabled} onChange={e => setGalleryEnabled(e.target.checked)} /><div><strong>Tải gallery nhiều ảnh về máy</strong><p className="muted" style={{ margin: "3px 0 6px" }}>Cần đã chọn "Gallery ảnh" bằng Extension ở bước Dạy crawler. Mỗi ảnh ghi 1 dòng vào bảng gallery.</p>
          {galleryEnabled && <div className="mapping-grid" style={{ marginTop: 0 }}>
            <label>Bảng gallery<select value={galleryTable} onChange={e => { setGalleryTable(e.target.value); setGalleryParentColumn(""); setGalleryPathColumn(""); }}><option value="">— Chọn bảng —</option>{db.schema.tables.filter(t => t.name !== db.config.mainTable).map(t => <option key={t.name}>{t.name}</option>)}</select></label>
            <label>Cột id_parent<select value={galleryParentColumn} onChange={e => setGalleryParentColumn(e.target.value)}><option value="">—</option>{(galleryTableSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
            <label>Cột đường dẫn ảnh<select value={galleryPathColumn} onChange={e => setGalleryPathColumn(e.target.value)}><option value="">—</option>{(galleryTableSchema?.columns || []).map(c => <option key={c.name}>{c.name}</option>)}</select></label>
          </div>}
        </div></div>
        <UrlRewriteEditor rules={urlRewriteRules} onChange={setUrlRewriteRules} sampleUrls={imageSampleUrls} />
      </SubSection>

      <SubSection title="Chống trùng lặp bản ghi">
        <div className="mapping-toggle"><input type="checkbox" checked={existingEnabled} onChange={e => setExistingEnabled(e.target.checked)} /><div><strong>Bỏ qua bản ghi đã tồn tại (khuyên dùng)</strong><p className="muted" style={{ margin: "3px 0 6px" }}>Chỉ hiện các cột thực sự có dữ liệu từ Recipe — chọn cột không có dữ liệu sẽ khiến tính năng này không bao giờ nhận ra bản ghi trùng.</p><div className="chip-list" style={{ marginTop: 6 }}>{(mainSchemaForMapping?.columns || []).filter(c => c.name !== "id" && populatedMainColumns.has(c.name)).map(c => <label key={c.name} className={matchColumns.includes(c.name) ? "selected" : ""}><input type="checkbox" checked={matchColumns.includes(c.name)} onChange={e => setMatchColumns(e.target.checked ? [...matchColumns, c.name] : matchColumns.filter(x => x !== c.name))} /><span>{c.name}</span></label>)}</div></div></div>
      </SubSection>

      <div style={{ marginTop: 16 }}><button className="primary-large" disabled={!!busy || !seoTable || !seoParentColumn || !seoComColumn || !seoActColumn || !seoTypeColumn} onClick={saveMapping}>{busy === "mapping" ? "Đang lưu…" : "Lưu cấu hình"}</button>{mappingSaved && <span style={{ marginLeft: 10, color: "var(--success)", fontWeight: 700 }}>✓ Đã lưu</span>}</div>
    </section>}

    {db?.config.mainTable && <section className="flow-card">
      <div className="flow-title"><span className="flow-number">6</span><div><h2>Xuất Project</h2><p>Đóng gói final.sql, delta.sql, toàn bộ ảnh đã tải và recipe thành 1 file .zip để bàn giao.</p></div></div>
      <div style={{ marginTop: 12 }}><button className="primary-large" disabled={exportBusy} onClick={runExport}>{exportBusy ? "Đang đóng gói…" : "Xuất final.sql + delta.sql + assets"}</button></div>
      {exportBundle && <div className="success-line" style={{ marginTop: 12, flexWrap: "wrap" }}>
        <div><strong><a href={exportBundle.downloadUrl}>{exportBundle.fileName}</a></strong><span> · final.sql {(exportBundle.finalSqlBytes / 1024).toFixed(1)} KB · delta.sql {(exportBundle.deltaSqlBytes / 1024).toFixed(1)} KB · {exportBundle.assetCount} ảnh · {exportBundle.recipeCount} recipe</span></div>
        <code>SHA-256 {exportBundle.sha256}</code>
      </div>}
    </section>}

    <details className="advanced-zone">
      <summary>Công cụ nâng cao — chỉ mở khi cần kiểm tra</summary>
      <div className="advanced-content">
        {db && <><div className="section-head"><div><h2>Schema & dữ liệu hiện có</h2><p className="muted">Dành cho debug cấu trúc SQL.</p></div></div>{db.schema.tables.map(table => <SchemaTableView key={table.name} table={table} onBrowse={browseTable} />)}</>}
        {browse && <div className="browse-box"><div className="section-head"><h2>{browse.table}</h2><button className="secondary" onClick={() => setBrowse(null)}>Đóng</button></div><div className="table-scroll"><table><thead><tr>{browse.columns.map(c => <th key={c}>{c}</th>)}</tr></thead><tbody>{browse.rows.map((row, i) => <tr key={i}>{browse.columns.map(c => <td key={c}><code>{row[c] == null ? "NULL" : typeof row[c] === "object" ? JSON.stringify(row[c]) : String(row[c]).slice(0, 240)}</code></td>)}</tr>)}</tbody></table></div><div className="pager"><button className="secondary" disabled={browse.offset === 0} onClick={() => browseTable(browse.table, Math.max(0, browse.offset - browse.limit))}>← Trước</button><button className="secondary" disabled={browse.offset + browse.limit >= browse.total} onClick={() => browseTable(browse.table, browse.offset + browse.limit)}>Sau →</button></div></div>}
        {db && <div className="danger-tools"><button className="danger" disabled={!!busy} onClick={reset}>Reset workspace</button><button disabled={!!busy} onClick={exportSql}>Export SQL</button>{exportInfo && <div className="export-box"><a href={exportInfo.downloadUrl}>{exportInfo.fileName}</a><code>SHA-256 {exportInfo.sha256}</code></div>}</div>}
      </div>
    </details>

    {conflictReview && <div className="modal-backdrop">
      <div className="modal-box">
        <h2>{conflictReview.conflicts.length} sản phẩm đã tồn tại trong Database</h2>
        <p className="muted">Chọn hành động cho từng sản phẩm trùng bên dưới, hoặc áp dụng một hành động cho tất cả. Mặc định là Bỏ qua — chưa ghi gì cho tới khi bạn bấm Xác nhận.</p>
        <div className="conflict-bulk">
          <span>Áp dụng cho tất cả:</span>
          <button className="small secondary" onClick={() => setConflictReview({ ...conflictReview, decisions: Object.fromEntries(conflictReview.conflicts.map(c => [c.queueItemId, "skip"])) })}>Bỏ qua hết</button>
          <button className="small secondary" onClick={() => setConflictReview({ ...conflictReview, decisions: Object.fromEntries(conflictReview.conflicts.map(c => [c.queueItemId, "overwrite"])) })}>Ghi đè hết</button>
          <button className="small secondary" onClick={() => setConflictReview({ ...conflictReview, decisions: Object.fromEntries(conflictReview.conflicts.map(c => [c.queueItemId, "insert"])) })}>Vẫn thêm mới hết</button>
        </div>
        <div className="conflict-list">
          {conflictReview.conflicts.map(c => <div className="conflict-row" key={c.queueItemId}>
            <div className="conflict-info"><code>{c.url}</code><span className="small muted">Trùng với bản ghi #{c.matchedId} theo {Object.entries(c.matchedOn).map(([k, v]) => `${k}=${v}`).join(", ")}</span></div>
            <select value={conflictReview.decisions[c.queueItemId] || "skip"} onChange={e => setConflictReview({ ...conflictReview, decisions: { ...conflictReview.decisions, [c.queueItemId]: e.target.value as ImportDecision } })}>
              <option value="skip">Bỏ qua</option>
              <option value="overwrite">Ghi đè</option>
              <option value="insert">Vẫn thêm mới</option>
            </select>
          </div>)}
        </div>
        <div className="modal-actions">
          <button className="secondary" disabled={!!importBusyId} onClick={() => setConflictReview(null)}>Hủy</button>
          <button className="primary-large" disabled={!!importBusyId} onClick={confirmImport}>{importBusyId ? "Đang xử lý…" : "Xác nhận Import"}</button>
        </div>
      </div>
    </div>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<App />);
