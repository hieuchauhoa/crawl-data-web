# PHASE 1 — SQL Workspace & Schema Engine

Implemented in this package:

- Immutable uploaded SQL copy + SHA-256 verification.
- Isolated MariaDB workspace database.
- Restricted temporary import user.
- Workspace metadata and baseline SQL snapshot.
- Schema inspection: tables, engine, collation, columns, keys and indexes.
- Exact existing-record count on demand + paginated record preview.
- `id_*` relation suggestions, explicitly marked as suggestions.
- Confirm/reject relation workflow.
- Main table + related table configuration.
- Safe workspace reset from the stored import copy.
- SQL export to a new file without touching the input.
- Empty `delta.ndjson` journal created as the Phase 1 delta-tracking foundation.

## Acceptance checklist

- [ ] Import the real SQL into MariaDB.
- [ ] `Input unchanged` shows PASS.
- [ ] All tables are visible.
- [ ] Columns/type/default/key/indexes are visible.
- [ ] Existing Data can open and paginate records.
- [ ] Relation suggestions appear for applicable `id_*` columns.
- [ ] Suggestions can be confirmed/rejected.
- [ ] Main table can be selected.
- [ ] Related tables can be selected.
- [ ] Export SQL downloads successfully.
- [ ] Import exported SQL into a clean DB and compare schema/data counts with the workspace baseline.
- [ ] Reset workspace restores baseline data.
- [ ] `delta.ndjson` exists and starts empty before crawler mutations exist.

Note: byte-for-byte equality is not required for `mariadb-dump`; logical schema + data equivalence is the acceptance condition.
