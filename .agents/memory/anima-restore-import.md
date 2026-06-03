---
name: Anima restore vs import
description: Two distinct backup-ingest endpoints — /import (migration, empty-only) and /restore (user-driven, any account).
---

# Restore vs Import

There are TWO server endpoints that ingest a backup payload (`{ entities, profile }`), and they are NOT interchangeable:

- `/store/import` — one-time local→server MIGRATION. Refuses any non-empty account (`account_not_empty`). Still used by `syncBootstrap.js` (client `bulkImport`). Do NOT repurpose it for user restores.
- `/store/restore` — user-driven "Restore From Backup" in Settings. Works on a NON-empty account. Takes `mode`:
  - `merge`: upsert backup records by id over current data; records not in the backup are untouched. Profile = existing overlaid with backup (backup wins, existing-only keys kept).
  - `replace`: wipe ALL of the user's `user_entities` first, then insert backup; profile overwritten outright with backup profile. Runs inside `db.transaction` so a failure never half-wipes.

**Why:** the migration gate exists so first-sign-in bootstrap can't clobber/duplicate; restore is an explicit user action that must work post-migration. Keeping them separate preserves both guarantees.

**How to apply:** client helper is `restoreData(payload, mode)` in `base44Client.js`; Settings shows a merge/replace choice dialog with a second confirm step for replace before calling it. Tests live in `artifacts/api-server/test/store.test.ts`.
