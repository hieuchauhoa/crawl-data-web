import fs from "node:fs/promises";
import fssync from "node:fs";
import path from "node:path";
import os from "node:os";
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { BridgeEvent, CrawlRecipe, ImportDecision, RelationSuggestion, WorkspaceConfig } from "@crawl/shared";
import { config } from "./config.js";
import { exportWorkspace, importSqlUpload, readTableRows, resetWorkspace, testMariaDb } from "./db.js";
import { applyBridgeEvent, clearDatabase, deleteRecipe, findRecipeForUrl, getState, incrementDelta, initState, saveRecipe, setDatabase, setWorkspaceConfig, updateWorkspaceSchema } from "./state.js";
import { deleteCrawlRun, getCrawlRuntime, initCrawlRuntime, pauseCrawl, resumeCrawl, retryFailed, startCrawl } from "./crawl.js";
import { deleteImportRun, getImportRun, getImportRuns, importCrawlRun, initMappingRuntime, previewImportConflicts, rollbackImportRun } from "./mapping.js";
import { buildExportBundle } from "./export.js";

// A Recipe id embeds its hostname (see freshRecipe() in the extension), and for a file:// test page
// that "hostname" is a filesystem folder path — easily past Fastify's default 100-char router param
// limit, which rejected a correctly-encoded delete request outright (FST_ERR_MAX_PARAM_LENGTH) before
// it ever reached the route handler's own "not found" check. This is a local single-user tool, not a
// public endpoint, so there's no meaningful abuse surface being traded away by raising it.
const app = Fastify({ logger: true, maxParamLength: 4096 });

await app.register(cors, {
  origin(origin, callback) {
    // Pinning to exactly "http://127.0.0.1:5173" broke as soon as Vite picked a different port (e.g.
    // 5173 already in use, so it moved to 5174) — a routine dev-machine occurrence, not a security
    // event, so this local tool allows any port on 127.0.0.1/localhost rather than one hardcoded port.
    const allowed = !origin || /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin) || origin.startsWith("chrome-extension://");
    if (!allowed) app.log.warn({ origin }, "CORS: origin not allowed");
    callback(allowed ? null : new Error("Origin not allowed"), allowed);
  }
});
await app.register(multipart, { limits: { files: 1, fileSize: 1024 * 1024 * 1024 } });
await initState();
await initCrawlRuntime();
await initMappingRuntime();

app.get("/api/health", async () => {
  let db: { ok: boolean; version?: string; error?: string };
  try { db = { ok: true, version: await testMariaDb() }; }
  catch (error) { db = { ok: false, error: error instanceof Error ? error.message : String(error) }; }
  return { ok: true, phase: 3, serverTime: new Date().toISOString(), mariadb: db,
    state: { lastExtensionSeen: getState().lastExtensionSeen, database: getState().database?.database || null } };
});

app.get("/api/state", async () => getState());

app.post("/api/bridge", async (request, reply) => {
  const event = request.body as BridgeEvent;
  if (!event || typeof event !== "object" || typeof event.type !== "string" || typeof event.pageUrl !== "string") {
    return reply.code(400).send({ ok: false, error: "Invalid bridge event" });
  }
  await applyBridgeEvent(event);
  return { ok: true };
});

app.get("/api/recipes", async () => ({ ok: true, recipes: getState().recipes, activeRecipeId: getState().activeRecipeId }));

app.get("/api/recipes/activate", async (request) => {
  const query = request.query as { url?: string };
  const recipe = query.url ? findRecipeForUrl(query.url) : null;
  return { ok: true, recipe };
});

app.post("/api/recipes", async (request, reply) => {
  const recipe = request.body as CrawlRecipe;
  if (!recipe || recipe.version !== 2 || !recipe.id || !recipe.hostname || !recipe.source?.startUrl) {
    return reply.code(400).send({ ok: false, error: "Recipe Phase 2 không hợp lệ." });
  }
  const saved = await saveRecipe(recipe);
  return { ok: true, recipe: saved };
});

app.delete("/api/recipes/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  if (!getState().recipes.some(r => r.id === id)) return reply.code(404).send({ ok: false, error: "Recipe không tồn tại." });
  await deleteRecipe(id);
  return { ok: true };
});

app.post("/api/sql/import", async (request, reply) => {
  // Importing always provisions a brand-new, empty MariaDB database (see importSqlUpload) — it never
  // reuses or merges into whatever workspace is already active. Re-importing without noticing this
  // silently strands the current workspace's crawled/imported data behind a pointer the tool no longer
  // shows anywhere, which is exactly the trap that kept biting during testing. So when a workspace is
  // already active, the caller must explicitly opt in via ?confirm=1 after being shown what's at stake.
  const existing = getState().database;
  const confirm = (request.query as { confirm?: string }).confirm === "1";
  if (existing && !confirm) {
    return reply.code(409).send({
      ok: false,
      requiresConfirm: true,
      error: "Đã có workspace đang dùng — import file mới sẽ tạo database RỖNG khác và bạn sẽ không còn thấy dữ liệu đã crawl/import trong workspace hiện tại từ Tool nữa (dữ liệu cũ không bị xoá dưới MariaDB, chỉ là Tool không còn trỏ tới).",
      currentDatabase: { originalName: existing.originalName, database: existing.database }
    });
  }
  const part = await request.file();
  if (!part) return reply.code(400).send({ ok: false, error: "Chưa chọn file SQL." });
  if (!part.filename.toLowerCase().endsWith(".sql")) return reply.code(400).send({ ok: false, error: "Chỉ nhận file .sql" });
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crawl-p1-"));
  const tempPath = path.join(tempDir, "upload.sql");
  try {
    const handle = await fs.open(tempPath, "w");
    try {
      for await (const chunk of part.file) await handle.write(chunk);
      if (part.file.truncated) throw new Error("File SQL vượt giới hạn 1 GB.");
    } finally { await handle.close(); }
    const result = await importSqlUpload(tempPath, part.filename);
    await setDatabase(result);
    return { ok: true, result };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  } finally { await fs.rm(tempDir, { recursive: true, force: true }); }
});

app.get("/api/workspace/table/:table/rows", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa import SQL." });
  const { table } = request.params as { table: string };
  const query = request.query as { offset?: string; limit?: string };
  const result = await readTableRows(workspace.database, table, Number(query.offset || 0), Number(query.limit || 25));
  return { ok: true, result };
});

app.put("/api/workspace/config", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const body = request.body as Partial<WorkspaceConfig>;
  const tableNames = new Set(workspace.schema.tables.map(t => t.name));
  const mainTable = body.mainTable ?? workspace.config.mainTable;
  const relatedTables = body.relatedTables ?? workspace.config.relatedTables;
  if (mainTable && !tableNames.has(mainTable)) return reply.code(400).send({ ok: false, error: "Main table không hợp lệ." });
  if (relatedTables.some(t => !tableNames.has(t))) return reply.code(400).send({ ok: false, error: "Related table không hợp lệ." });
  const normalizedRelated = [...new Set(relatedTables)].filter(t => t !== mainTable);
  const allowedTables = new Set(mainTable ? [mainTable, ...normalizedRelated] : normalizedRelated);
  const relations = body.relations ?? workspace.config.relations;
  for (const relation of relations) {
    if (!allowedTables.has(relation.sourceTable) || !allowedTables.has(relation.targetTable)) {
      return reply.code(400).send({ ok: false, error: "Relation chỉ được phép dùng Main/Related tables đã chọn." });
    }
    if (relation.sourceTable === relation.targetTable) {
      return reply.code(400).send({ ok: false, error: "Source và target của relation phải là hai bảng khác nhau." });
    }
    const source = workspace.schema.tables.find(t => t.name === relation.sourceTable);
    const target = workspace.schema.tables.find(t => t.name === relation.targetTable);
    if (!source?.columns.some(c => c.name === relation.sourceColumn) || !target?.columns.some(c => c.name === relation.targetColumn)) {
      return reply.code(400).send({ ok: false, error: "Column trong relation không hợp lệ." });
    }
  }

  const seo = body.seo === undefined ? workspace.config.seo : body.seo;
  if (seo) {
    const seoTable = workspace.schema.tables.find(t => t.name === seo.seoTable);
    if (!seoTable) return reply.code(400).send({ ok: false, error: "SEO table không hợp lệ." });
    const requiredCols = [seo.parentColumn, seo.comColumn, seo.actColumn, seo.typeColumn];
    const optionalCols = [seo.titleColumn, seo.descriptionColumn, seo.keywordsColumn].filter((c): c is string => !!c);
    for (const col of [...requiredCols, ...optionalCols]) {
      if (!seoTable.columns.some(c => c.name === col)) return reply.code(400).send({ ok: false, error: `Cột SEO "${col}" không tồn tại trong ${seo.seoTable}.` });
    }
  }
  const existingRecord = body.existingRecord === undefined ? workspace.config.existingRecord : body.existingRecord;
  if (existingRecord) {
    if (!mainTable) return reply.code(400).send({ ok: false, error: "Cần chọn Main table trước khi cấu hình existing-record." });
    const mainSchema = workspace.schema.tables.find(t => t.name === mainTable);
    if (!existingRecord.matchColumns.length || existingRecord.matchColumns.some(c => !mainSchema?.columns.some(col => col.name === c))) {
      return reply.code(400).send({ ok: false, error: "Match column của existing-record không hợp lệ." });
    }
  }
  const assets = body.assets === undefined ? workspace.config.assets : body.assets;
  if (assets) {
    if (assets.avatarColumn) {
      const t = workspace.schema.tables.find(x => x.name === assets.avatarColumn!.table);
      if (!t?.columns.some(c => c.name === assets.avatarColumn!.column)) return reply.code(400).send({ ok: false, error: "Cột avatar không hợp lệ." });
    }
    if (assets.galleryTable) {
      const t = workspace.schema.tables.find(x => x.name === assets.galleryTable!.table);
      if (!t?.columns.some(c => c.name === assets.galleryTable!.parentColumn) || !t?.columns.some(c => c.name === assets.galleryTable!.pathColumn)) {
        return reply.code(400).send({ ok: false, error: "Cột gallery không hợp lệ." });
      }
    }
  }

  await setWorkspaceConfig({ mainTable, relatedTables: normalizedRelated, relations, seo, existingRecord, assets });
  return { ok: true, config: getState().database!.config };
});


app.delete("/api/workspace/relations/:id", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const { id } = request.params as { id: string };
  const exists = workspace.config.relations.some(r => r.id === id);
  if (!exists) return reply.code(404).send({ ok: false, error: "Relation không tồn tại." });

  // Delete is intentionally independent from full config validation. This lets
  // users clean stale/legacy relations even when those old rows reference tables
  // that are no longer selected in Main/Related configuration.
  const relations = workspace.config.relations.filter(r => r.id !== id);
  await setWorkspaceConfig({ ...workspace.config, relations });
  return { ok: true, relations };
});

app.put("/api/workspace/relations/:id", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const { id } = request.params as { id: string };
  const body = request.body as Partial<RelationSuggestion>;
  const existing = workspace.config.relations.find(r => r.id === id);
  if (!existing) return reply.code(404).send({ ok: false, error: "Relation không tồn tại." });
  const targetTable = body.targetTable ?? existing.targetTable;
  const targetColumn = body.targetColumn ?? existing.targetColumn;
  const target = workspace.schema.tables.find(t => t.name === targetTable);
  if (!target || !target.columns.some(c => c.name === targetColumn)) {
    return reply.code(400).send({ ok: false, error: "Target table/column không hợp lệ." });
  }
  if (body.status && !["suggested", "confirmed", "rejected"].includes(body.status)) {
    return reply.code(400).send({ ok: false, error: "Relation status không hợp lệ." });
  }
  const relations = workspace.config.relations.map(r => r.id === id ? { ...r, ...body, targetTable, targetColumn, id: r.id } : r);
  await setWorkspaceConfig({ ...workspace.config, relations });
  return { ok: true, relations };
});

app.delete("/api/workspace", async (_request, reply) => {
  if (!getState().database) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  await clearDatabase();
  return { ok: true };
});

app.post("/api/workspace/reset", async (_request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const schema = await resetWorkspace(workspace);
  await updateWorkspaceSchema(schema);
  return { ok: true, schema };
});

app.post("/api/workspace/export", async (_request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const result = await exportWorkspace(workspace);
  return { ok: true, result: { ...result, downloadUrl: `/api/workspace/export-file/${encodeURIComponent(result.fileName)}` } };
});

app.get("/api/workspace/export-file/:name", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const { name } = request.params as { name: string };
  const safe = path.basename(name);
  const target = path.join(workspace.exportDir, safe);
  if (!target.startsWith(workspace.exportDir) || !fssync.existsSync(target)) return reply.code(404).send({ ok: false, error: "Export không tồn tại." });
  reply.header("Content-Type", "application/sql; charset=utf-8");
  reply.header("Content-Disposition", `attachment; filename="${safe}"`);
  return reply.send(fssync.createReadStream(target));
});


app.post("/api/export/bundle", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  try {
    const result = await buildExportBundle(workspace, getState().recipes, getCrawlRuntime(), getImportRuns());
    return { ok: true, result };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
app.get("/api/export/download/:name", async (request, reply) => {
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const { name } = request.params as { name: string };
  const safe = path.basename(name);
  const target = path.join(workspace.exportDir, safe);
  if (!target.startsWith(workspace.exportDir) || !fssync.existsSync(target)) return reply.code(404).send({ ok: false, error: "Export không tồn tại." });
  reply.header("Content-Type", "application/zip");
  reply.header("Content-Disposition", `attachment; filename="${safe}"`);
  return reply.send(fssync.createReadStream(target));
});

app.get("/api/crawl", async () => ({ ok: true, runtime: getCrawlRuntime() }));

app.post("/api/crawl/start", async (request, reply) => {
  const body = request.body as { recipeId?: string; mode?: "test"|"full"; workers?: number };
  const recipe = getState().recipes.find(r => r.id === body.recipeId);
  if (!recipe) return reply.code(404).send({ ok:false, error:"Recipe không tồn tại." });
  if (!recipe.list.item || !recipe.list.detailUrl) return reply.code(400).send({ ok:false, error:"Recipe thiếu repeated item hoặc detail URL selector." });
  const mode = body.mode === "full" ? "full" : "test";
  if (mode === "full") { const passed = getCrawlRuntime().runs.some(r => r.recipeId===recipe.id && r.mode==="test" && r.status==="completed" && r.queue.some(q=>q.status==="success")); if(!passed) return reply.code(409).send({ok:false,error:"Phải Test 1 item thành công trước khi Crawl All."}); }
  const run = await startCrawl(recipe, mode, Number(body.workers || 4));
  return { ok:true, run };
});
app.post("/api/crawl/:id/pause", async (request) => ({ ok:true, run: await pauseCrawl((request.params as {id:string}).id) }));
app.post("/api/crawl/:id/resume", async (request, reply) => {
  const id=(request.params as {id:string}).id; const run=getCrawlRuntime().runs.find(r=>r.id===id);
  const recipe=getState().recipes.find(r=>r.id===run?.recipeId); if(!run||!recipe) return reply.code(404).send({ok:false,error:"Run/Recipe không tồn tại."});
  return {ok:true,run:await resumeCrawl(id,recipe)};
});
app.post("/api/crawl/:id/retry", async (request, reply) => {
  const id=(request.params as {id:string}).id; const run=getCrawlRuntime().runs.find(r=>r.id===id);
  const recipe=getState().recipes.find(r=>r.id===run?.recipeId); if(!run||!recipe) return reply.code(404).send({ok:false,error:"Run/Recipe không tồn tại."});
  return {ok:true,run:await retryFailed(id,recipe)};
});

app.delete("/api/crawl/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  try { await deleteCrawlRun(id); return { ok: true }; }
  catch (error) { return reply.code(409).send({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
});

app.get("/api/import", async () => ({ ok: true, runs: getImportRuns() }));
app.delete("/api/import/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  try { await deleteImportRun(id); return { ok: true }; }
  catch (error) { return reply.code(404).send({ ok: false, error: error instanceof Error ? error.message : String(error) }); }
});
app.get("/api/import/:id", async (request, reply) => {
  const { id } = request.params as { id: string };
  const run = getImportRun(id);
  if (!run) return reply.code(404).send({ ok: false, error: "Import run không tồn tại." });
  return { ok: true, run };
});
app.post("/api/import/:id/rollback", async (request, reply) => {
  const { id } = request.params as { id: string };
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  const run = getImportRun(id);
  if (!run) return reply.code(404).send({ ok: false, error: "Import run không tồn tại." });
  if (run.rolledBack) return reply.code(409).send({ ok: false, error: "Lần import này đã được xoá trước đó." });
  try {
    const result = await rollbackImportRun(workspace, run);
    return { ok: true, result };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});
app.post("/api/import/preview/:runId", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  if (!workspace.config.mainTable) return reply.code(409).send({ ok: false, error: "Chưa chọn Main table." });
  const crawlRun = getCrawlRuntime().runs.find(r => r.id === runId);
  if (!crawlRun) return reply.code(404).send({ ok: false, error: "Crawl run không tồn tại." });
  const recipe = getState().recipes.find(r => r.id === crawlRun.recipeId);
  if (!recipe) return reply.code(404).send({ ok: false, error: "Recipe không tồn tại." });
  try {
    const result = await previewImportConflicts(workspace, recipe, crawlRun);
    return { ok: true, result };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/import/from-crawl/:runId", async (request, reply) => {
  const { runId } = request.params as { runId: string };
  const body = request.body as { decisions?: Record<string, ImportDecision> } | undefined;
  const workspace = getState().database;
  if (!workspace) return reply.code(409).send({ ok: false, error: "Chưa có workspace." });
  if (!workspace.config.mainTable) return reply.code(409).send({ ok: false, error: "Chưa chọn Main table." });
  const crawlRun = getCrawlRuntime().runs.find(r => r.id === runId);
  if (!crawlRun) return reply.code(404).send({ ok: false, error: "Crawl run không tồn tại." });
  if (!crawlRun.queue.some(q => q.status === "success")) return reply.code(409).send({ ok: false, error: "Crawl run chưa có item nào thành công." });
  const recipe = getState().recipes.find(r => r.id === crawlRun.recipeId);
  if (!recipe) return reply.code(404).send({ ok: false, error: "Recipe không tồn tại." });
  try {
    const result = await importCrawlRun(workspace, recipe, crawlRun, body?.decisions);
    if (result.insertedRows) await incrementDelta(result.insertedRows);
    return { ok: true, result };
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  const statusCode = typeof error === "object" && error !== null && "statusCode" in error && typeof error.statusCode === "number" ? error.statusCode : 500;
  reply.code(statusCode).send({ ok: false, error: error instanceof Error ? error.message : String(error) });
});

await app.listen({ host: config.host, port: config.port });
app.log.info(`Phase 3 Local Tool API: http://${config.host}:${config.port}`);
