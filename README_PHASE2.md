# Crawl Data Web — Phase 2

Phase 2 builds the visual **Extension Selector Builder** on top of the completed Phase 1 SQL Workspace.

## Run on Linux Mint XFCE

```bash
cd crawl-data-web-phase2
cp apps/server/.env.example apps/server/.env
npm install
npm run typecheck
npm run build
npm run dev
```

Local UI: `http://127.0.0.1:5173`

Chrome extension:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Load unpacked: `apps/extension/dist`.
4. Open the source website.
5. Use `Crawl Builder · Phase 2` on the right side.

## Recommended flow

1. Keep/import the SQL workspace and select Main/Related tables in Local Tool.
2. On list page choose Item group.
3. Choose Detail URL.
4. Choose Avatar.
5. Choose Breadcrumb and map levels to SQL tables/columns as needed.
6. Choose Pagination, or use `Không có paging` and optionally paste page-2 URL.
7. Open a detail page and map SQL fields using text/HTML/attribute extraction.
8. Read SEO (it is also automatically sampled on sync).
9. Save Recipe.
10. Reload the target page and verify the Recipe activates again.

See `PHASE2_ACCEPTANCE.md` for implemented and live-test items.
