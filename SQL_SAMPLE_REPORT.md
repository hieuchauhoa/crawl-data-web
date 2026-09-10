# SQL sample verification — Phase 0

- File: `admin_aiwritter_com.sql`
- Size: 5,709,539 bytes
- SHA-256: `4e5ef67e0d390f6c893c0307fd524032a8494be0c24452a94a83e29b2254ab11`
- CREATE TABLE count: 57

## Required tables

- `bmws_product`: FOUND
- `bmws_news`: FOUND
- `bmws_seo`: FOUND

## Relevant schema notes

### `bmws_product`

Columns: `id`, `id_list`, `id_item`, `id_cat`, `id_sub`, `id_brand`, `photo`, `options`, `slugvi`, `slugen`, `contenten`, `contentvi`, `descen`, `descvi`, `nameen`, `namevi`, `code`, `regular_price`, `discount`, `sale_price`, `numb`, `status`, `type`, `date_created`, `date_updated`, `view`.
Primary key / AUTO_INCREMENT are applied later with `ALTER TABLE`; next AUTO_INCREMENT observed: `152`.

### `bmws_news`

Columns: `id`, `id_list`, `id_item`, `id_cat`, `id_sub`, `photo`, `photo_link`, `photo_type`, `photo1`, `options`, `slugvi`, `slugen`, `contenten`, `contentvi`, `descen`, `descvi`, `nameen`, `namevi`, `map_code`, `numb`, `status`, `type`, `date_created`, `date_updated`, `view`.
Primary key / AUTO_INCREMENT are applied later with `ALTER TABLE`; next AUTO_INCREMENT observed: `80`.

### `bmws_seo`

Columns: `id`, `id_parent`, `com`, `act`, `type`, `titlevi`, `keywordsvi`, `descriptionvi`, `titleen`, `keywordsen`, `descriptionen`, `seo_focusvi`.
Primary key / AUTO_INCREMENT are applied later with `ALTER TABLE`; next AUTO_INCREMENT observed: `301`.

## Import-safety check

- `CREATE DATABASE` statements: 0
- `DROP DATABASE` statements: 0
- `USE` statements: 0

The backend must inspect MariaDB after the complete import rather than inferring keys only from the initial `CREATE TABLE` blocks.
