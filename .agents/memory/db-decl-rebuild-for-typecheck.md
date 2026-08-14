---
name: lib/db declaration rebuild for api-server typecheck
description: Why api-server typecheck reports "@workspace/db has no exported member X" after a schema change, and how to fix
---

# Rebuild lib/db declarations after schema edits

`lib/db` is a TS project-references package (composite, emitDeclarationOnly) that
emits `.d.ts` into `lib/db/dist`. Consumers like api-server reference it via
project references and resolve types from that emitted `dist`, NOT from the live
`src`.

**Symptom:** after editing `lib/db/src/schema/index.ts` (e.g. adding a new table
export), `pnpm --filter @workspace/api-server run typecheck` fails with
`Module '"@workspace/db"' has no exported member 'X'` — even for pre-existing
exports — because `tsc -p ... --noEmit` does NOT rebuild referenced projects, so
it reads stale declarations.

**Fix:** rebuild the db declarations first: `cd lib/db && npx tsc -b`. Then
re-run the consumer's typecheck.

**Note:** the api-server dev workflow is `build && start` via esbuild (which
bundles `src` directly, no watch), so the running server picks up schema changes
on restart regardless — this gotcha is specifically about the `tsc` typecheck.
