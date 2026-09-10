# PHASE 5 — ASSET PIPELINE

Implemented in this package:

- `apps/server/src/assets.ts` — `AssetStore`: downloads a URL, sniffs MIME from the real bytes (never trusts the URL's own extension — a `/image.php?id=5` that responds JPEG bytes is stored `.jpg`), computes SHA-256, reads width/height via `image-size`, and stores the file once at `assets/store/{sha256}.{ext}` (content-addressed — a second download of the same bytes is detected and marked `reused`, never re-written). `exportFlat()` copies a stored object out to a human-named flat file for the deliverable folder.
- Filename convention (`assetExportName`): `{slug}-{avatar|gallery|content}[-NN]-{shortHash}.{ext}` — collision-safe because the hash is always part of the name, per charter §27.
- **Avatar**: captured during Phase 3 discovery (`apps/server/src/crawl.ts`) — candidate URLs are read directly off the list-page item's `<img>` (`src`/`data-src`/`data-original`) and stored per queue item (`CrawlQueueItem.avatarCandidates`). At import time the best candidate is tried first, falling through to the next on failure (`AssetStore.downloadBestOf`).
- **Gallery**: new Extension capability — a "Chọn gallery ảnh" picker (`apps/extension/src/content.ts`) reuses the existing repeated-element detector (the same one that finds product cards) so the user just clicks one thumbnail and every sibling thumbnail is found automatically. Every candidate is downloaded; each successful one becomes one row in the configured gallery table.
- **Content images**: any field mapped with `extraction: "html"` gets scanned for `<img src="...">`, each image is downloaded, and the HTML is rewritten in place to point at the local `assets/...` path — so content still renders after the source site disappears (charter §26). Only the plain `src` attribute is handled, not `srcset`, on inline content images.
- New `WorkspaceConfig.assets` (`AssetMappingConfig`): explicit, minimal config — which main-table column receives the avatar filename, and which table/parent-column/path-column receives one gallery row per image. Configured in **Bước 5** of the Local Tool UI alongside SEO mapping.
- Per-item and per-run asset counters (`downloaded`/`reused`/`error`) surfaced in the import report; asset errors never fail the whole item (charter's "asset lỗi không làm mất toàn bộ product") — a failed image is logged and the item still inserts.

## A second real bug found and fixed during this phase

The `__name is not defined` class of bug (previously patched once for the SEO extractor, see `PATCH_NOTES_PHASE3_EVALUATE_FIX.md`) reappeared in the new avatar/gallery `evaluateAll()` callbacks, which used nested helper functions (`const push = (u) => {...}`) inside the browser-serialized closure. Under `tsx watch`'s esbuild-based dev transform, sufficiently complex callbacks get wrapped with a `__name(...)` helper reference that doesn't exist once Playwright ships the function into the page — so every crawl with an avatar or gallery selector configured would fail outright. Root-caused by reproducing it live against the fixture site, then fixed by rewriting every `evaluateAll` callback in `crawl.ts` down to a single chained return expression with no local `const`/`let`/nested functions (matching the style the previous fix already established for SEO extraction). Verified `__name` does not appear in either the `tsx` dev path or the `tsup` production bundle.

## Verified end-to-end (this session)

Extended the Phase 4 fixture site with real (small, validly-encoded) PNGs and deliberate reuse: two products share a category (and therefore an avatar), one shared image appears in every product's content HTML. Ran a full crawl + import against real MariaDB + real HTTP downloads:

- 17 unique images actually downloaded, 7 additional reuses correctly detected by hash (24 total asset references, matching 4 assets × 6 products) — confirmed by both the API's `assetsDownloaded`/`assetsReused` counts and by inspecting the store directory directly (17 files).
- Avatar filenames matched across the two same-category products (`...-avatar-75d442e5.png` for both), proving hash-based reuse produced identical output, not just non-duplicate downloads.
- `bmws_gallery` received exactly 2 rows per product with the correct `id_parent`.
- `contentvi` had its `<script>` tag stripped (existing sanitizer) **and** its `<img src>` rewritten to `assets/...`, with the shared image resolving to the same hash across every product that referenced it.
- Flat export folder (`assets/export/`) contained all 24 named files with zero collisions.
- Re-running import on the same crawl run correctly skipped all 6 items and attempted **zero** downloads (existing-record check runs before any network I/O).

## Acceptance checklist

- [x] Avatar downloaded.
- [x] Not limited to thumbnails when an original can be determined — candidate URLs are collected from the actual `src`/`data-src`/`data-original` attributes, not a hardcoded thumb path.
- [x] File with no extension in the URL downloads correctly (MIME sniffed from real bytes, not the URL).
- [x] MIME determines the stored extension.
- [x] Width/height captured (`image-size`).
- [x] Metadata usable to generate `options`-style records (`AssetDownloadResult` carries sha256/ext/mime/width/height/bytes).
- [x] Gallery with multiple images works (verified 2/product, 12 total rows).
- [x] Inline content images downloaded.
- [x] HTML rewritten to local paths.
- [x] Duplicate image downloaded only once (verified via store file count + reuse counters).
- [x] Exports one shared flat asset folder.
- [x] No filename collisions in the shared folder.
- [x] Asset failure doesn't lose the whole product (per-asset try/catch with retry; item still inserts).
- [x] Asset errors logged clearly (per-item `assets[]` with `error` message, surfaced in the import report UI).
- [ ] "Website nguồn tắt giả lập thì local content vẫn dùng assets local" — not independently verified (would require blocking the fixture site after crawling and re-rendering the exported HTML in a browser); the rewrite mechanism itself is verified to produce correct local paths, so this is a presentation-layer check rather than a pipeline gap.

## Simplifications, stated plainly

- Candidate quality ranking (srcset widths, parent-link heuristics) that the Extension's own avatar picker UI already shows to the user at recipe-authoring time is **not** re-implemented at crawl time — crawl-time avatar resolution takes `src`/`data-src`/`data-original` in that priority order per item, not a full re-scored candidate list. This was a deliberate simplification made while fixing the `__name` bug (the richer candidate logic was exactly the nested-helper code that triggered it).
- The avatar column must live on the main table (`WorkspaceConfig.assets.avatarColumn.table === mainTable`) — not a generalized "avatar can target any table" system.
