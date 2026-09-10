# Crawl Data Web — Phase 4

This build continues directly from the accepted Phase 3 source and adds Data Mapping, Relations, Transform & SEO.

## What's new

- **Bước 5 — Cấu hình SEO & bản ghi đã tồn tại**: a new card in the Local Tool UI, shown once a main table is chosen. Pick the SEO table and its `id_parent`/`com`/`act`/`type` columns, the constant values to write, optional title/description/keywords columns, and which main-table columns identify an existing record (defaults to `slug`/`name`-like columns, policy is `Skip`).
- **Đưa vào Database** button on each crawl run card (enabled once SEO mapping is saved and the run has at least one successful item). Runs the mapping engine against that crawl run's already-extracted data — it never re-opens the browser.
- Category resolution reuses whatever confirmed relation you already set up in **Bước 2** (e.g. `bmws_product.id_cat → bmws_product_cat.id`) — there's no separate "which column is the category" field to fill in.

## Test flow

1. Complete Phases 1–3 as before (import SQL, pick main/related tables + relations, build a Recipe, run Test 1 item then Crawl toàn bộ).
2. In **Bước 5**, pick the SEO table and confirm/adjust the guessed column mapping, fill in `com`/`act`/`type` (e.g. product → `product`/`man`/`san-pham`), leave "Bỏ qua bản ghi đã tồn tại" checked, click **Lưu cấu hình**.
3. On a completed crawl run, click **Đưa vào Database**. Check the report: inserted / skipped (already existed) / error counts, plus the total SQL rows written (product + related + SEO).
4. Re-run **Đưa vào Database** on the same run to confirm idempotency: everything should report as skipped, not duplicated.
5. If a mapping was wrong (e.g. SEO column choice), fix it in Bước 5 and run **Đưa vào Database** again — this reuses the same crawl data, no re-crawl needed.

## Phase boundary

Phase 4 does not touch the Asset Pipeline (Phase 5): `photo`/gallery/content-image URLs are copied as-is into the mapped columns, not downloaded or rewritten yet. `final.sql`/`delta.sql`/asset export packaging remain Phase 6 scope; Phase 4 only increments the delta counter that Phase 6 will read.
