# Crawl Data Web — Phase 5 & 6

Continues directly from the accepted Phase 4 source. Adds the Asset Pipeline (avatar/gallery/content images) and Full Export (final.sql + delta.sql + assets + recipe + logs as one .zip).

## New dependencies

```bash
npm install
```

pulls in `image-size` (width/height detection) and `archiver@7` (zip building) for `@crawl/server`. **`archiver` must stay pinned to major version 7** — version 8 was rewritten to a class-based ESM API that the `@types/archiver` package doesn't describe; it type-checks fine but crashes at runtime (`does not provide an export named 'default'`). If `npm install` ever pulls in v8 again, pin it back:

```bash
npm install archiver@7 --workspace @crawl/server
```

## What's new in the Extension

A **"Chọn gallery ảnh"** button now appears in Bước 5 (Detail Mapping), next to the breadcrumb picker. Click one thumbnail in the product's image strip on the detail page; it reuses the same repeated-element detector as the product-card picker, so every sibling thumbnail is found automatically. Reload the Extension (chrome://extensions → reload) to get this — an already-saved Recipe from before this change simply has no gallery selector until you redo this step.

## What's new in the Local Tool

**Bước 5** gained two more toggles alongside the existing SEO config:
- **Tải ảnh đại diện (avatar) về máy** — pick which column on the main table receives the downloaded avatar's local filename.
- **Tải gallery nhiều ảnh về máy** — pick the gallery table + its parent-id column + its path column. Requires the Extension's gallery selector to have been set (previous step).

**Bước 6 — Xuất Project** is new: one button produces and downloads a `.zip` with `final.sql`, `delta.sql`, `recipe.json`, `logs/`, and `assets/`.

## Test flow

1. Complete Phases 1–4 as before, but in the Extension's detail-mapping step also click **Chọn gallery ảnh** once on a sample detail page.
2. In Bước 5, turn on avatar/gallery, pick the columns, **Lưu cấu hình**.
3. Crawl toàn bộ, then **Đưa vào Database** — watch for the new "Ảnh tải mới / Ảnh trùng / Ảnh lỗi" counters under the SQL row counts.
4. **Xuất Project** — download the zip, unzip it, sanity-check `final.sql`/`delta.sql`/`assets/`.
5. To verify a truly clean handoff: `mysql -uroot <newdb> < final.sql` into an empty database and confirm the data + Vietnamese text look right.

## Phase boundary

Everything through the charter's MVP Definition of Done (§53) now has working code and has been run for real at least once against a real MariaDB and real HTTP downloads (see `PHASE5_ACCEPTANCE.md` / `PHASE6_ACCEPTANCE.md` for exactly what was verified and what wasn't). What's explicitly **not** done: a real multi-page run against the charter's named external test sites at production scale (~vài trăm sản phẩm), and an automated regression suite — both listed as next steps in `PHASE6_ACCEPTANCE.md` rather than silently skipped.
