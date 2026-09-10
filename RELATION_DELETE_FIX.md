# Relation delete 400 fix

## Root cause
The old Relation Suggestions UX had persisted auto-detected relations into `workspace.config.relations`.
After the new Main/Related-table UX was introduced, `/api/workspace/config` validates every relation against the currently selected tables. Deleting one relation by saving the whole config still submitted the remaining stale relations, so the request returned HTTP 400.

## Fix
- Added `DELETE /api/workspace/relations/:id` that removes exactly one relation without re-validating unrelated stale rows.
- The web UI now uses that endpoint for the **Xóa** button.
- On server startup, Phase 1 state is migrated by keeping only confirmed relations that belong to the selected Main/Related tables.
- The delete button shows `Đang xóa…` while the request is running.
