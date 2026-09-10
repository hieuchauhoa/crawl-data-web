import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import readline from "node:readline";
import mysql from "mysql2/promise";
import type {
  RelationSuggestion,
  SchemaInspection,
  SqlImportResult,
  TableRowsResult,
  WorkspaceConfig
} from "@crawl/shared";
import { config, phase1Dir } from "./config.js";

const REQUIRED_TABLES = ["bmws_product", "bmws_news", "bmws_seo"] as const;

function adminOptions() {
  return {
    host: config.maria.host,
    port: config.maria.port,
    user: config.maria.user,
    password: config.maria.password,
    charset: "utf8mb4"
  };
}

export async function testMariaDb() {
  const connection = await mysql.createConnection(adminOptions());
  const [rows] = await connection.query("SELECT VERSION() AS version");
  await connection.end();
  return (rows as Array<{ version: string }>)[0]?.version || "unknown";
}

function safeFileName(name: string) {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base || "input.sql";
}

export async function sha256File(filePath: string) {
  return await new Promise<string>((resolve, reject) => {
    const hash = createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("data", chunk => hash.update(chunk));
    input.on("error", reject);
    input.on("end", () => resolve(hash.digest("hex")));
  });
}

async function makeWorkspaceImportCopy(inputPath: string, outputPath: string) {
  const reader = readline.createInterface({ input: fs.createReadStream(inputPath, { encoding: "utf8" }), crlfDelay: Infinity });
  const writer = fs.createWriteStream(outputPath, { encoding: "utf8" });
  let removed = 0;

  for await (const line of reader) {
    if (/^\s*(?:CREATE\s+DATABASE\b|DROP\s+DATABASE\b|USE\b)/i.test(line)) {
      removed += 1;
      continue;
    }
    writer.write(`${line}${os.EOL}`);
  }

  await new Promise<void>((resolve, reject) => {
    writer.end(resolve);
    writer.on("error", reject);
  });
  return removed;
}

async function findCli(kind: "client" | "dump") {
  const candidates: string[] = [];
  if (kind === "client" && config.maria.cli) candidates.push(config.maria.cli);
  if (kind === "dump" && config.maria.dumpCli) candidates.push(config.maria.dumpCli);
  candidates.push(...(kind === "client" ? ["mariadb", "mysql"] : ["mariadb-dump", "mysqldump"]));

  for (const candidate of candidates) {
    const probe = spawnSync(candidate, ["--version"], { windowsHide: true, encoding: "utf8" });
    if (!probe.error && probe.status === 0) return candidate;
  }
  throw new Error(kind === "client"
    ? "Không tìm thấy MariaDB CLI (mariadb/mysql). Hãy cấu hình MARIADB_CLI."
    : "Không tìm thấy mariadb-dump/mysqldump. Hãy cấu hình MARIADB_DUMP_CLI.");
}

type ImportCredential = { user: string; password: string };

async function createRestrictedImportUser(database: string): Promise<ImportCredential> {
  const user = `crawl_p1_${randomBytes(5).toString("hex")}`;
  const password = randomBytes(24).toString("base64url");
  const admin = await mysql.createConnection(adminOptions());
  try {
    await admin.query(`CREATE USER ?@'%' IDENTIFIED BY ?`, [user, password]);
    await admin.query(`GRANT ALL PRIVILEGES ON \`${database}\`.* TO ?@'%'`, [user]);
  } finally {
    await admin.end();
  }
  return { user, password };
}

async function dropRestrictedImportUser(user: string) {
  const admin = await mysql.createConnection(adminOptions());
  try { await admin.query(`DROP USER IF EXISTS ?@'%'`, [user]); } finally { await admin.end(); }
}

async function runImport(database: string, sqlPath: string, credential: ImportCredential) {
  const cli = await findCli("client");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(cli, [
      `--host=${config.maria.host}`,
      `--port=${config.maria.port}`,
      `--user=${credential.user}`,
      "--default-character-set=utf8mb4",
      "--protocol=tcp",
      database
    ], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, MYSQL_PWD: credential.password }
    });

    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`MariaDB import thất bại (exit ${code}): ${stderr.slice(-4000)}`)));
    fs.createReadStream(sqlPath).on("error", reject).pipe(child.stdin);
  });
}

async function createDatabase(database: string) {
  const admin = await mysql.createConnection(adminOptions());
  try { await admin.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`); }
  finally { await admin.end(); }
}

export async function dropDatabase(database: string) {
  const admin = await mysql.createConnection(adminOptions());
  try { await admin.query(`DROP DATABASE IF EXISTS \`${database}\``); }
  finally { await admin.end(); }
}

function relationCandidates(tableNames: string[], sourceTable: string, sourceColumn: string): RelationSuggestion[] {
  if (!/^id_/i.test(sourceColumn)) return [];
  const suffix = sourceColumn.replace(/^id_/, "").toLowerCase();
  const prefix = sourceTable.includes("_") ? sourceTable.split("_")[0] : "";
  const candidates = tableNames
    .filter(t => t !== sourceTable)
    .map(targetTable => {
      const tail = targetTable.toLowerCase().replace(new RegExp(`^${prefix}_?`), "");
      let confidence = 0;
      let reason = "";
      if (tail === suffix) { confidence = 0.95; reason = `Tên ${sourceColumn} khớp trực tiếp bảng ${targetTable}`; }
      else if (tail.endsWith(`_${suffix}`) || tail === `product_${suffix}` || tail === `news_${suffix}`) { confidence = 0.88; reason = `Hậu tố ${suffix} khớp bảng ${targetTable}`; }
      else if (targetTable.toLowerCase().endsWith(`_${suffix}`)) { confidence = 0.82; reason = `Tên bảng kết thúc bằng ${suffix}`; }
      return { targetTable, confidence, reason };
    })
    .filter(x => x.confidence >= 0.8)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 2);

  return candidates.map((candidate, index) => ({
    id: `${sourceTable}.${sourceColumn}->${candidate.targetTable}.id`,
    sourceTable,
    sourceColumn,
    targetTable: candidate.targetTable,
    targetColumn: "id",
    confidence: Number((candidate.confidence - index * 0.03).toFixed(2)),
    reason: candidate.reason,
    status: "suggested"
  }));
}

export async function inspectSchema(database: string): Promise<SchemaInspection> {
  const connection = await mysql.createConnection({ ...adminOptions(), database });
  try {
    const [tableRows] = await connection.query(
      `SELECT TABLE_NAME AS tableName, ENGINE AS engine, TABLE_COLLATION AS collation, TABLE_ROWS AS estimatedRows
       FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME`, [database]);
    const [columnRows] = await connection.query(
      `SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, COLUMN_TYPE AS columnType,
              IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue, COLUMN_KEY AS columnKey,
              EXTRA AS extra, ORDINAL_POSITION AS ordinalPosition
       FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [database]);
    const [indexRows] = await connection.query(
      `SELECT TABLE_NAME AS tableName, INDEX_NAME AS indexName, NON_UNIQUE AS nonUnique,
              COLUMN_NAME AS columnName, SEQ_IN_INDEX AS seqInIndex
       FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX`, [database]);

    type TableRow = { tableName: string; engine: string | null; collation: string | null; estimatedRows: number | null };
    type ColumnRow = { tableName: string; columnName: string; columnType: string; isNullable: "YES" | "NO"; defaultValue: string | null; columnKey: string; extra: string; ordinalPosition: number };
    type IndexRow = { tableName: string; indexName: string; nonUnique: number; columnName: string; seqInIndex: number };

    const columns = columnRows as ColumnRow[];
    const indexes = indexRows as IndexRow[];
    const tables = (tableRows as TableRow[]).map(table => {
      const tableIndexes = indexes.filter(i => i.tableName === table.tableName);
      const names = [...new Set(tableIndexes.map(i => i.indexName))];
      return {
        name: table.tableName,
        engine: table.engine,
        collation: table.collation,
        estimatedRows: table.estimatedRows == null ? null : Number(table.estimatedRows),
        columns: columns.filter(c => c.tableName === table.tableName).map(c => ({
          name: c.columnName, type: c.columnType, nullable: c.isNullable === "YES",
          defaultValue: c.defaultValue == null ? null : String(c.defaultValue), key: c.columnKey,
          extra: c.extra, ordinal: Number(c.ordinalPosition)
        })),
        indexes: names.map(name => ({
          name,
          unique: tableIndexes.find(i => i.indexName === name)?.nonUnique === 0,
          primary: name === "PRIMARY",
          columns: tableIndexes.filter(i => i.indexName === name).sort((a, b) => a.seqInIndex - b.seqInIndex).map(i => i.columnName)
        }))
      };
    });

    const tableNames = tables.map(t => t.name);
    const relations = tables.flatMap(table => table.columns.flatMap(column => relationCandidates(tableNames, table.name, column.name)));

    return {
      database,
      tables,
      required: Object.fromEntries(REQUIRED_TABLES.map(name => [name, tables.some(t => t.name === name)])) as SchemaInspection["required"],
      relations
    };
  } finally { await connection.end(); }
}

function assertIdentifier(value: string) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) throw new Error("Invalid SQL identifier");
  return value;
}

export async function readTableRows(database: string, table: string, offset = 0, limit = 25): Promise<TableRowsResult> {
  assertIdentifier(table);
  const safeLimit = Math.min(100, Math.max(1, Math.floor(limit)));
  const safeOffset = Math.max(0, Math.floor(offset));
  const connection = await mysql.createConnection({ ...adminOptions(), database });
  try {
    const [exists] = await connection.query(`SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`, [database, table]);
    if (!(exists as unknown[]).length) throw new Error(`Table ${table} không tồn tại trong workspace.`);
    const [countRows] = await connection.query(`SELECT COUNT(*) AS total FROM \`${table}\``);
    const total = Number((countRows as Array<{ total: number }>)[0]?.total || 0);
    const [rows, fields] = await connection.query(`SELECT * FROM \`${table}\` LIMIT ? OFFSET ?`, [safeLimit, safeOffset]);
    return { table, columns: fields.map(f => f.name), rows: rows as Array<Record<string, unknown>>, total, offset: safeOffset, limit: safeLimit };
  } finally { await connection.end(); }
}

export async function dumpDatabase(database: string, outputPath: string) {
  const cli = await findCli("dump");
  await fsp.mkdir(path.dirname(outputPath), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(outputPath);
    const child = spawn(cli, [
      `--host=${config.maria.host}`, `--port=${config.maria.port}`, `--user=${config.maria.user}`,
      "--default-character-set=utf8mb4", "--skip-comments", "--routines", "--triggers", "--events",
      "--single-transaction", database
    ], { env: { ...process.env, MYSQL_PWD: config.maria.password }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", c => { stderr += c; });
    child.stdout.pipe(out);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve() : reject(new Error(`Export thất bại (exit ${code}): ${stderr.slice(-4000)}`)));
    out.on("error", reject);
  });
  return outputPath;
}

export async function exportWorkspace(workspace: SqlImportResult) {
  const fileName = `export-${new Date().toISOString().replace(/[:.]/g, "-")}.sql`;
  const outputPath = path.join(workspace.exportDir, fileName);
  await dumpDatabase(workspace.database, outputPath);
  return { outputPath, fileName, sha256: await sha256File(outputPath) };
}

export async function resetWorkspace(workspace: SqlImportResult): Promise<SchemaInspection> {
  await dropDatabase(workspace.database);
  await createDatabase(workspace.database);
  let credential: ImportCredential | null = null;
  try {
    credential = await createRestrictedImportUser(workspace.database);
    await runImport(workspace.database, workspace.importCopyPath, credential);
  } catch (error) {
    await dropDatabase(workspace.database).catch(() => undefined);
    throw error;
  } finally {
    if (credential) await dropRestrictedImportUser(credential.user).catch(() => undefined);
  }
  return inspectSchema(workspace.database);
}

export async function importSqlUpload(tempUploadedPath: string, originalName: string): Promise<SqlImportResult> {
  await fsp.mkdir(phase1Dir, { recursive: true });
  const id = `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomBytes(3).toString("hex")}`;
  const workspaceDir = path.join(phase1Dir, "workspaces", id);
  const inputDir = path.join(workspaceDir, "input");
  const snapshotDir = path.join(workspaceDir, "snapshots");
  const exportDir = path.join(workspaceDir, "exports");
  const assetsStoreDir = path.join(workspaceDir, "assets", "store");
  const assetsExportDir = path.join(workspaceDir, "assets", "export");
  await Promise.all([fsp.mkdir(inputDir, { recursive: true }), fsp.mkdir(snapshotDir, { recursive: true }), fsp.mkdir(exportDir, { recursive: true }), fsp.mkdir(assetsStoreDir, { recursive: true }), fsp.mkdir(assetsExportDir, { recursive: true })]);

  const storedPath = path.join(inputDir, safeFileName(originalName));
  await fsp.copyFile(tempUploadedPath, storedPath);
  const sha256Before = await sha256File(storedPath);
  const importCopyPath = path.join(inputDir, "workspace-import.sql");
  const removedDatabaseLevelStatements = await makeWorkspaceImportCopy(storedPath, importCopyPath);

  const database = `crawl_p1_${Date.now()}_${randomBytes(3).toString("hex")}`;
  await createDatabase(database);
  let credential: ImportCredential | null = null;
  try {
    credential = await createRestrictedImportUser(database);
    await runImport(database, importCopyPath, credential);
  } catch (error) {
    await dropDatabase(database).catch(() => undefined);
    throw error;
  } finally {
    if (credential) await dropRestrictedImportUser(credential.user).catch(() => undefined);
  }

  const sha256After = await sha256File(storedPath);
  const schema = await inspectSchema(database);
  const baselinePath = path.join(snapshotDir, "baseline.sql");
  await dumpDatabase(database, baselinePath);
  const workspaceConfig: WorkspaceConfig = { mainTable: null, relatedTables: [], relations: [], seo: null, existingRecord: null, assets: null };
  const deltaLogPath = path.join(workspaceDir, "delta.ndjson");
  await fsp.writeFile(path.join(workspaceDir, "workspace.json"), JSON.stringify({ id, database, originalName, createdAt: new Date().toISOString(), config: workspaceConfig }, null, 2));
  await fsp.writeFile(deltaLogPath, "", "utf8");

  return {
    id, database, originalName, storedPath, importCopyPath, baselinePath, exportDir, assetsStoreDir, assetsExportDir, deltaLogPath,
    createdAt: new Date().toISOString(), sha256Before, sha256After,
    inputUnchanged: sha256Before === sha256After,
    removedDatabaseLevelStatements, schema, config: workspaceConfig, deltaOperationCount: 0
  };
}
