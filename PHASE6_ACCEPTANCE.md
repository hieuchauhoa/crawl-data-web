# PHASE 6 — FULL INTEGRATION, EXPORT & RELIABILITY

Implemented in this package:

- `apps/server/src/export.ts` — `buildExportBundle()`: produces a single `.zip` containing `final.sql` (full current DB dump via the same `mysqldump`-based path Phase 1 already used), `delta.sql`, `recipe.json` (every saved Recipe), and `logs/` (`crawl-runs.json` + `import-runs.json`), plus `assets/` (the flat export folder from Phase 5) when any assets exist. Exposed as **Bước 6 — Xuất Project** in the Local Tool UI with one button and a download link.
- **delta.sql is a replay log, not a re-derived diff.** Every real `INSERT` executed by the Phase 4/5 mapping engine (`apps/server/src/mapping.ts`) is appended to a per-workspace `delta.ndjson` file as a structured record — but only *after* its transaction commits (buffered in memory during the transaction so a rollback never leaves a phantom entry). At export time each record is rendered into a literal `INSERT INTO ... VALUES (...);` statement. This means delta.sql reflects exactly what the crawler wrote, independent of trying to diff current-vs-baseline DB state.
- Crash recovery: unchanged from Phase 3 (`initCrawlRuntime`) — already persists continuously to disk and recovers `running`/`discovering` state on restart. No new work needed; still verified working during this session (the dev server was restarted several times mid-testing and always resumed correctly).

## Verified end-to-end (this session)

Continuing directly from the Phase 5 fixture run (6 products, categories, gallery, SEO, assets already in the DB):

- Called the export endpoint; got back a `.zip` with `final.sql` (7.9 KB), `delta.sql` (5.1 KB), `recipe.json`, `logs/`, and 24 asset files — downloaded and unzipped it to confirm the actual contents (not just the API response).
- `delta.sql` contained exactly 30 `INSERT` statements — 6 products + 12 gallery rows + 6 SEO rows + 6 categories, matching the run precisely, with correct escaping (Vietnamese diacritics, embedded HTML with quotes) and explicit IDs preserved.
- **Re-imported `final.sql` into a brand-new, empty database** (`mysql < final.sql` into a freshly created DB) and confirmed every row landed correctly: products with correct avatar filenames, 12 gallery rows, 6 SEO rows, 6 categories, and the pre-existing baseline row (`Sản phẩm mẫu`) with its Vietnamese text intact — no encoding corruption, no broken escaping.
- Re-ran import against the same crawl run afterward: 0 inserted, 6 skipped, 0 asset downloads attempted — confirming Update-Crawl-style re-runs stay safe and cheap.

## Acceptance checklist

- [x] Full workflow reachable end-to-end: SQL → chọn bảng → dạy crawler → test → crawl toàn bộ → cấu hình SEO/ảnh → đưa vào Database → xuất Project.
- [x] Full Crawl runs (verified, Phase 3/4/5 sessions).
- [x] Retry Failed (Phase 3, unchanged).
- [x] Re-map without re-crawl (Phase 4, unchanged — mapping config is edited and replayed against already-crawled data).
- [x] SQL transaction per item (Phase 4, unchanged; now also guards delta-log buffering).
- [x] Export `final.sql`.
- [x] Export `delta.sql`.
- [x] Export `assets/`.
- [x] Export `recipe.json`.
- [x] Export logs.
- [x] Import `final.sql` into a clean database succeeds.
- [x] No Vietnamese encoding errors.
- [x] No broken HTML/SQL escaping.
- [x] Pause/resume mid-run (Phase 3, unchanged, re-verified via crash-recovery testing this session).
- [x] Abrupt shutdown + reopen recovers correctly (the dev server was killed and restarted multiple times mid-session during debugging; state was intact every time).
- [ ] "Update Crawl", "Re-crawl Selected" as named, separate UI modes — not built as distinct features. In practice they're achievable today (re-run Full Crawl on the same Recipe, then re-run Import; Skip policy prevents overwrites) but there's no dedicated "select these rows only" UI.
- [ ] Regression test suite — not added; verification in this and prior phases was manual/scripted against a real MariaDB + real HTTP fixture, not a committed automated test suite.
- [ ] Tested on at least two real external websites — verified against one real site's DOM structure (`chatpiano.vn`, for the Phase 2 selector bug) and one purpose-built fixture site (for Phase 3–6 pipeline correctness); the charter's named test sites (Website A/B) have not been run end-to-end in this session.

## What "MVP complete" means here, plainly

Every stage of the Definition of Done in the charter (§53) has working code behind it and has been exercised for real — against a real MariaDB, real HTTP downloads, and a real production build — at least once. What has **not** happened is a long-running, high-volume crawl against one of the charter's actual named target sites over many pages; the fixture-site testing proves the pipeline is correct, not that it's been battle-tested at the "vài trăm sản phẩm" scale the charter targets. That's the natural next step before calling this a finished product for real use.
