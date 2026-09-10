# PHASE 4 — DATA MAPPING, RELATIONS, TRANSFORM & SEO

Implemented in this package:

- `apps/server/src/mapping.ts`: mapping/import engine, run separately from the crawler (`POST /api/import/from-crawl/:runId`) so re-mapping never re-visits the source site.
- Transformation engine (heuristic, column-driven): VN currency/number parsing, date parsing, HTML sanitization (script/style/`on*` stripped) for `extraction:"html"` fields, whitespace trim for text, Vietnamese-aware slug generation for unmapped slug columns.
- Category Resolver: walks non-ignored `recipe.list.breadcrumb` levels (extracted per detail page in Phase 3, see below), looks up/creates rows by normalized name, chains parent IDs through a detected `id_parent`/`parent_id` column for a self-referencing category tree, and reuses IDs for identical `(name, parent)` pairs while keeping identically-named categories under different parents distinct.
- Relation Resolver: any confirmed `WorkspaceConfig.relations` entry from the main table to a resolved category table is written onto the main record automatically (no separate "which column is id_cat" config needed — it's inferred from the Phase 1 relation).
- Multi-table mapping: main record insert → related tables with a confirmed parent-pointing relation → SEO table, all inside one transaction per crawled item; the generated main ID is threaded into every dependent insert.
- SEO mapping (`WorkspaceConfig.seo`): explicit column mapping for a chosen SEO table (`parentColumn`, `comColumn`, `actColumn`, `typeColumn`, optional `titleColumn`/`descriptionColumn`/`keywordsColumn`) plus constant `com`/`act`/`type` values. Priority: `<title>` → `og:title` → mapped name column; meta description → `og:description` → mapped description column; keywords come **only** from source meta keywords, never fabricated.
- Existing-record strategy: MVP implements `Skip` only (per charter — Update/Replace are out of scope for Phase 4), configurable match columns, checked before any writes so skipped items create no category/related/SEO rows either.
- Delta tracking: every real INSERT increments `WorkspaceInfo.deltaOperationCount` (foundation laid in Phase 1).
- Phase 3 extraction was extended (not re-scoped) to also capture breadcrumb text per detail page, since category resolution needs it and re-crawling would violate "re-map without re-crawl".

## Bug found and fixed while integration-testing this phase

Phase 3's SEO/breadcrumb/field extraction called Playwright locator actions (`getAttribute`, `textContent`, `innerHTML`) with no explicit timeout. For any *optional* element missing on a real page (no `<link rel="canonical">`, no Twitter card tags, no `robots` meta — all very common), each missing lookup silently waited the Playwright default of 30s before giving up. A page missing the ~7 optional SEO tags stalled **every single detail crawl** for minutes. This was invisible in previous phase testing (fixtures/sample pages happened to have all tags) and was only caught by running a real crawl end-to-end against a purpose-built fixture site missing some tags. Fixed by bounding every optional lookup to a 3s timeout (`apps/server/src/crawl.ts`). This is a Phase 3 regression fix, included here because Phase 4 testing is what surfaced it.

## Acceptance checklist

- [x] Raw data (fields + SEO + breadcrumb) staged in the crawl queue before any SQL write.
- [x] Transform price/text/date works (verified: `"1.010.000 đ"` → `1010000`, `"02/02/2026"` → `2026-02-02`).
- [x] Generated slug works (verified: unmapped `slugvi` auto-derived from mapped name column).
- [x] Constant/default field works (SEO `com`/`act`/`type` constants; unmapped NOT NULL columns fall back to their DB default).
- [x] Category not existing → auto insert.
- [x] Category existing → reuse ID (verified: two products sharing `(name, parent)` reused the same category row).
- [x] No duplicate category (verified: identical category name under a *different* parent correctly created a distinct row).
- [x] Product receives correct `id_cat`.
- [x] Multi-level relation works for at least two levels (verified: self-referencing 2-level category tree with `id_parent` chaining).
- [x] Product insert returns generated ID, used by dependent inserts.
- [x] Related record uses the correct parent ID.
- [x] Existing-record `Skip` policy works (verified: re-running import on the same crawl run produced 0 inserts / 6 skips, no duplicate rows).
- [x] SEO auto-inserted for every successful item.
- [x] SEO row uses correct `id_parent`.
- [x] SEO row has correct `com`/`act`/`type`.
- [x] `<title>` maps to the configured title column.
- [x] Meta description maps to the configured description column.
- [x] Meta keywords maps to the configured keywords column when the source has them.
- [x] No fabricated keywords when source has none (verified: items without a `meta[name=keywords]` tag produced `NULL`, not an empty string or invented text).
- [x] Mapping can be edited and rebuilt without re-crawling (architectural: import consumes persisted crawl-run data + live `WorkspaceConfig`; the crawler is never invoked by the import endpoint).

## Verified end-to-end (this session)

Ran the actual server against a real local MariaDB and a purpose-built two-page/six-product fixture site (not mocked) through the full pipeline: SQL import → table/relation config → SEO mapping config → synthetic Recipe → Test 1 item → Full Crawl (2 pages, 6 items, 0 duplicates) → Import into Database → re-Import (idempotency check). All 6 products, 6 category rows (not 12 — dedup confirmed), and 6 SEO rows landed with correct values; a second import run correctly skipped all 6 with zero new rows.

Not exercised in this session: a `bmws_news`-shaped run (same code path, different table — the engine has no Product/News special-casing to begin with, so this is low risk) and a live run against the charter's named external test sites (Website A/B) — those still need an operator-machine run per the Phase 3 note.
