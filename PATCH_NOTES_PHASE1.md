# Phase 1 patch notes

Phase 0 browser-extension behavior is preserved. This patch upgrades the local SQL layer to a persistent Phase 1 workspace engine.

New API endpoints:

- `GET /api/workspace/table/:table/rows`
- `PUT /api/workspace/config`
- `PUT /api/workspace/relations/:id`
- `POST /api/workspace/reset`
- `POST /api/workspace/export`
- `GET /api/workspace/export-file/:name`

Workspace layout:

```text
workspaces/phase1/workspaces/<workspace-id>/
├── input/
│   ├── <original>.sql
│   └── workspace-import.sql
├── snapshots/
│   └── baseline.sql
├── exports/
├── workspace.json
└── delta.ndjson
```
