---
name: Drizzle jsonb expression index breaks publish migration
description: Why btree indexes with `data -> 'field'` (jsonb) columns fail the production publish-time schema diff, and the safe pattern.
---

# Drizzle jsonb expression indexes break the publish-time migration

A Drizzle btree index that mixes plain text columns with a **jsonb-returning**
expression column — `index(...).on(t.userId, t.entityName, sql\`(data -> 'field')\`)`
— makes Replit's publish-time schema-diff DDL generator **misassign operator
classes**. It emits `jsonb_ops` onto an adjacent *text* column, e.g.:

```
CREATE INDEX ... USING btree (user_id text_ops, entity_name jsonb_ops, ((data -> 'field')) jsonb_ops)
-- ERROR: operator class "jsonb_ops" does not accept data type text
```

Postgres rejects it, so **Publish fails at the migration step** ("Failed to run
database migration statement"). It only surfaces on publish, not in dev, because
dev applies the schema via `drizzle-kit push` (different code path) and the dev
index itself is valid.

**Why:** the diff generator's per-column opclass serialization shifts when an
index contains a raw `sql` jsonb expression. The created/updated sort indexes that
cast to `::numeric` / `collate "C"` (text) do NOT hit this — only `jsonb_ops`
landing on a text column produces an invalid statement.

**How to apply:**
- In any expression index, project jsonb fields to **text** with `->>` (or cast to
  `::numeric`), never bare `->`. Then every column resolves to a text/numeric
  opclass and the generated DDL is valid regardless of the shift.
- Keep the matching query expression on `->>` too so the planner still uses the
  index (see `store-list-query-pushdown.md`). For always-string keys like
  `session_id`, `data ->> 'k' = $1` is equivalent to the jsonb equality.
- Pure-equality jsonb filters that must stay type-faithful (the generic
  `filterCondition`, `data -> 'k' = …::jsonb`) simply should NOT have a dedicated
  jsonb btree index — rely on the `(user_id, entity_name)` partition index.
- After changing index defs, `cd lib/db && pnpm run push-force` to update the dev
  DB, then verify with `SELECT indexdef FROM pg_indexes WHERE tablename=...` that
  no `jsonb_ops` appears, before telling the user to re-publish.

**Note:** the production DB only changes on Publish (read-only to the agent). Never
write a migration script / deploy hook / startup DDL to fix prod — fix the schema
source of truth, push to dev, and re-publish.
