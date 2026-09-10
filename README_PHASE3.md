# Crawl Data Web — Phase 3

This build continues directly from the accepted Phase 2 source and adds Crawl Core, Queue & Pagination Engine.

## Linux Mint XFCE setup

From the project directory:

```bash
npm install
npx playwright install chromium
npm run typecheck
npm run build
npm run dev
```

If Playwright reports missing Linux libraries:

```bash
sudo npx playwright install-deps chromium
```

Then open Local Tool as before and keep MariaDB running.

## Test flow

1. Load/import the same SQL workspace used in Phase 2.
2. Ensure a saved Recipe exists.
3. In **Phase 3 Crawl Runner**, keep Workers = 4 initially.
4. Click **Test 1 item**.
5. Wait for status `completed`, with `success = 1`.
6. Check extracted URL, attempt, HTTP result and crawl log.
7. Only after the successful test, **Crawl All** becomes available.
8. Start Full Crawl and verify pagination page count and URL totals.
9. During a run, press **Pause**; then **Resume** and verify success rows are not re-run.
10. For a failed URL, use **Retry failed** and verify only failed rows return to pending.

## Bảo Minh pagination testcase

For a Phase 2 Recipe created on `https://xulynuocbaominh.com/san-pham`, the runner consumes the saved pagination `{page}` pattern/detected max. Expected acceptance is discovery of all four testcase pages with no duplicate canonical detail URLs.

For a no-pagination News Recipe, discovery runs once and stops cleanly.

## Phase boundary

Phase 3 stores extracted fields + SEO in the crawl queue result but deliberately does **not** insert mapped product/news/category/SEO records into SQL. Staging, transformations, relations and SQL mapping belong to Phase 4.
