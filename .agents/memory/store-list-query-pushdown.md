---
name: store list query pushdown (filter/sort/limit in SQL)
description: Durable rules for keeping the store list endpoint's SQL pushdown faithful to the client's legacy in-memory query semantics
---

# Store list endpoint: push filter/sort/limit into SQL, keep legacy semantics

`GET /api/store/:entity` filters/sorts/limits in Postgres over the
per-(user, entity) JSONB partition instead of loading all rows and doing it in
JS. The hard constraint: results must stay identical to the client's old
in-memory query helper.

## Non-obvious decisions / traps

- **Equality filters are type-faithful, mirroring JS `===`.** `5` must not match
  `"5"`, and a filter of `null` matches only a present JSON null (an absent key
  is not a match). Object/array filter values are an impossible condition (JS
  reference-equality never matches a parsed value). Don't "helpfully" coerce.

- **Sort is type-dependent and cannot always be one ORDER BY.** The legacy
  comparator decides numeric-vs-lexical *per pair* (numeric only when BOTH values
  are numbers, `String()` compare otherwise). For a mixed number/non-number
  column this is genuinely impossible to reproduce as a single SQL ORDER BY — and
  is even intransitive, so the old JS order was itself undefined there.
  **Why:** a single ORDER BY key forces all numbers into one group ahead of/after
  all strings, which differs from the per-pair rule (e.g. asc `2` vs `"10"` →
  legacy puts `"10"` first by string compare, not `2` first by number).
  **How to apply:** push ORDER BY only for the homogeneous case; detect a
  mixed-type sort column and fall back to sorting in JS with the exact legacy
  comparator (filters still pushed down). Real data is always homogeneous per
  field, so the fallback is a correctness safety net, rarely hit.

- **Missing/null sorts LAST in both directions** (not flipped by `-`). Lexical
  compare must use `COLLATE "C"` (byte order = JS string `<`); the DB's default
  locale collation orders case differently and would drift.

- **Testing nulls-last needs a non-auto field.** The create/update route
  auto-populates `created_date`/`updated_date`, so they're never absent — use a
  different custom field to exercise missing-value ordering.

- **Inline identifier field names as SQL literals** (validate `^[A-Za-z0-9_]+$`,
  else bound param). **Why:** expression indexes are on a constant key like
  `data -> 'created_date'`; a bind param (`data -> $1`) prevents the planner from
  matching them.

- **Indexes must mirror the ORDER BY expression exactly.** The created/updated
  indexes encode the same numeric-CASE + `COLLATE "C"` + `DESC NULLS LAST` shape;
  if you change the ORDER BY, change the index in lockstep or it stops being used
  (verify with EXPLAIN — no Sort node for `-created_date`/`-updated_date`+limit).

- **`offset` is pushed into SQL too** (real `OFFSET`, paired with `LIMIT`) for
  one-page-at-a-time paging; the mixed-type JS fallback applies it via
  `data.slice(off, off+cap)` so both paths agree. The pagination hook fetches
  `limit = pageSize + 1` and derives `hasMore` from the extra row (no grand
  `total` — can't be known from a single page). **Why:** the old client over-
  fetched `pageSize + skip` rows and sliced in JS, which got slow deep into
  history. `withinOffset` truncates finite-positive, else 0; OFFSET-without-sort
  mirrors limit-without-sort (paging callers always pass a sort).
