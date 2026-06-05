---
name: Anima title search trigram index
description: How the store's case-insensitive title search is index-backed, and the pg_trgm extension requirement.
---

The store's title search (`store.ts` searchCondition: `(data ->> 'title') ilike '%term%'`)
is backed by a GIN trigram index `user_entities_title_trgm_idx` defined in `lib/db`
schema with `.using("gin", sql\`(data ->> 'title') gin_trgm_ops\`)`.

**Rule:** the indexed expression must stay the TEXT projection `data ->> 'title'`,
never the jsonb `data -> 'title'`.
**Why:** a jsonb (->) expression column makes the publish-time schema-diff emit a
jsonb operator class onto an adjacent text column, which Postgres rejects and which
blocks the production migration (same hazard documented in drizzle-jsonb-index-publish).

**Rule:** `pg_trgm` must exist before `drizzle-kit push` runs, because push does NOT
manage extensions — without it, creating the GIN index fails.
**How to apply:** `scripts/post-merge.sh` runs `psql "$DATABASE_URL" -c "CREATE
EXTENSION IF NOT EXISTS pg_trgm"` before `pnpm --filter db push`. The api-server test
DB clones `public` tables with `LIKE ... INCLUDING ALL`, so the trigram index (and
its gin_trgm_ops operator class, resolved from public) is copied automatically; no
test-setup change needed.

**Planner note:** with only one user's rows present the planner may prefer the
(user_id, entity_name) btree and filter ILIKE; the trigram index becomes the win on
a genuinely large/multi-user table where it bitmap-ANDs with the user/entity scope.
Confirmed usable via EXPLAIN. A per-user-scoped composite (btree_gin over
user_id+entity_name+title trgm) was intentionally NOT added — out of scope and needs
a second extension.
