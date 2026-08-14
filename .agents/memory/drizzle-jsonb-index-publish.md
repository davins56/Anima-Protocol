---
name: Drizzle jsonb expression index breaks publish migration
description: Why btree indexes with `data -> 'field'` (jsonb) columns fail the production publish-time schema diff, and the safe pattern.
---

# Drizzle jsonb expression indexes break the publish-time migration

**The rule: NO bare jsonb `->` may appear ANYWHERE in an expression index — not
even nested inside `jsonb_typeof(...)` or a CASE.** Use only the text projection
`->>` (optionally `::numeric`). Any bare `->` makes Replit's publish-time
schema-diff DDL generator misplace operator-class tokens, and it fails in (at
least) two shapes:

1. Top-level jsonb column → `jsonb_ops` lands on an adjacent *text* column:
```
CREATE INDEX ... USING btree (user_id text_ops, entity_name jsonb_ops, ((data -> 'field')) jsonb_ops)
-- ERROR: operator class "jsonb_ops" does not accept data type text
```
2. `->` nested inside a CASE (e.g. `jsonb_typeof(data -> 'created_date')`) →
opclass tokens get injected *inside* the CASE, producing a syntax error:
```
... USING btree (user_id numeric_ops, entity_name numeric_ops, (
CASE WHEN (jsonb_typeof((data -> 'created_date'::text)) = text_ops, ...
-- ERROR: syntax error at or near "text_ops"
```

Postgres rejects it, so **Publish fails at the migration step** ("Failed to run
database migration statement"). It only surfaces on publish, not in dev, because
dev applies the schema via `drizzle-kit push` (different code path) and the dev
index itself is valid.

**Why:** the diff generator's per-column opclass serialization shifts whenever an
index contains a raw `sql` jsonb (`->`) expression — wherever that `->` sits.
**Correction to a prior belief:** the `::numeric`/`collate "C"` created/updated
sort indexes were assumed safe; they were NOT — their `jsonb_typeof(data -> ...)`
CASE triggered shape #2. They now detect numbers with a regex on the `->>` text
(`(data ->> 'created_date') ~ '^-?[0-9]+([.][0-9]+)?$'`) instead, which matches
the canonical decimal text a jsonb number serializes to (no exponents), so the
`::numeric` cast stays safe and the index has no bare `->`. Non-indexed queries
(the mixed-type probe, generic equality filter) may still use `->`/`jsonb_typeof`
— only *expression indexes* trip the publish bug.

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
