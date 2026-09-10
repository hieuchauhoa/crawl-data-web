# Phase 2 — Extension Selector Builder

## Implemented

- Floating Crawl Builder panel in Chrome content script.
- Element highlighter without DevTools.
- Repeated item detection using structure/signature plus navigation penalties.
- Selector strategy with primary CSS, fallbacks, XPath, stable attributes and DOM fingerprint.
- Detail URL picker.
- Avatar picker and candidate resolver (`src`, `srcset`, lazy attributes, `picture`, parent image link, `og:image`).
- Breadcrumb picker with per-level SQL table/column mapping or ignore.
- Pagination container picker and URL-pattern inference for query/path page numbers.
- No-pagination flow with optional pasted page-2 URL for inference.
- Generic detail mapping against Phase 1 schema with text/HTML/attribute extraction.
- Automatic SEO extraction: title, description, keywords, canonical, OG, Twitter, robots and JSON-LD.
- Crawl Recipe v2 persisted by Local Tool.
- Recipe auto-activation after page reload by hostname/path.
- Manual correction by selecting any picker again; same mapped SQL field is replaced.

## Manual acceptance still required on target websites

The following need browser testing because they depend on live DOM/layout:

- Bảo Minh product repeated-group accuracy.
- Bảo Minh `?p={page}` inference and detected pages 1–4.
- Bảo Minh news no-pagination recipe.
- Breadcrumb hierarchy on sample sites.
- High-quality image candidates on sample detail pages.
- Recipe reload/activation after Chrome page reload.

## Boundary

Phase 2 intentionally does not run Playwright full crawl, queues, SQL inserts, asset downloads or relation resolution. Those remain Phase 3+.
