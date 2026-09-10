# Phase 3 patch — Playwright `__name is not defined`

Date: 2026-08-27

## Symptom

`Test 1 item` discovers the detail URL successfully, then fails while extracting detail/SEO with:

```text
page.evaluate: ReferenceError: __name is not defined
```

## Cause

The Phase 3 SEO extractor passed a TypeScript callback directly into `page.evaluate()`. During the server build, the callback could be transformed with an internal `__name` helper. Playwright serializes the callback into the browser page, but that helper is not present in the page context.

## Fix

- Removed `page.evaluate()` from SEO extraction.
- Read `<title>` using `page.title()`.
- Read meta/link attributes using Playwright locators.
- Read JSON-LD with `allTextContents()` and parse JSON on the Node side.
- Kept Recipe, queue state, pagination, retry, worker limits and Phase 2 behavior unchanged.

## Regression test

1. Run `Test 1 item` on `https://thuanninhcomputer.com/san-pham`.
2. Confirm discovery finds one detail URL.
3. Confirm detail completes as `success` rather than `failed` with `__name`.
4. Inspect extracted SEO/title fields.
5. Retry an existing failed run if desired, or create a new Test run.
