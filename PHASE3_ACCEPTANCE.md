# PHASE 3 — CRAWL CORE, QUEUE & PAGINATION ENGINE

Implemented in this package:

- Playwright headless crawler; Recipe v2 runs without Extension open.
- List discovery and detail workers are separate stages.
- URL canonicalization: absolute URL, fragment removal, trailing slash normalization, `utm_*`, `fbclid`, `gclid` removal.
- Per-run URL deduplication.
- Pagination: saved `{page}` pattern; detected max when available; stop on empty/no detail URLs, duplicate page fingerprint, no new URLs, HTTP error, max page.
- Page-2 URL fallback: infer a numeric query/path pattern when Phase 2 stored a manual page-2 URL.
- Persistent queue state: pending/running/success/failed.
- Attempts, HTTP status, source page, timestamps, last error.
- Test-one-item gate before Full Crawl.
- Worker concurrency 1–8, default 4.
- Pause, resume, retry failed.
- Crash recovery: old `running`/`discovering` run becomes `paused`; running queue items return to pending.
- Failure isolation per detail URL.
- Progress counters and URL/stage/error logs in Local Tool UI.
- Raw extracted detail fields + SEO retained on each successful queue item for Phase 4 staging/mapping.

## Acceptance checklist

- [x] Recipe can execute without Extension open.
- [x] Page 1 discovery supported.
- [x] Full detected pagination supported.
- [x] URL deduplication implemented.
- [x] Last-page stop conditions implemented.
- [x] No-pagination recipe executes one list page.
- [x] List discovery and detail workers are separate.
- [x] Test one item is required before Full Crawl.
- [x] Worker count configurable.
- [x] Safe worker limit enforced (1–8).
- [x] Pause implemented.
- [x] Resume does not re-run success items.
- [x] Failed URL retry implemented.
- [x] Detail failure does not stop entire run.
- [x] Progress displays pending/running/success/failed.
- [x] Logs include URL + stage + error.

Runtime website verification on the target test sites must be performed from the operator machine because the packaged crawler needs normal network access and a locally installed Playwright Chromium.
