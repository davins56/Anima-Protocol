import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, userEntities, userProfiles } from "@workspace/db";
import { and, eq, sql, type SQL } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";

const router = Router();

// Every store endpoint is per-user: derive the user id from the Clerk session
// and reject anything unauthenticated. The user id is NEVER taken from the
// request body — only from the verified session.
function requireUser(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  (req as Request & { userId: string }).userId = userId;
  next();
}

router.use(requireUser);

function getUserId(req: Request): string {
  return (req as Request & { userId: string }).userId;
}

function makeId(): string {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

// The client relies on SDK-style querying: optional equality filters, a sort
// string ("field" ascending, "-field" descending) and a numeric limit. These
// are pushed all the way down into the SQL query (filter -> WHERE, sort ->
// ORDER BY, limit -> LIMIT) so reads stay fast and memory-light as a user's
// history grows, instead of loading every row and filtering/sorting in JS.

// JSONB field names come from the request (filter keys / the sort string). When
// the name is a plain identifier we inline it as a SQL literal so the planner
// can match the expression indexes on user_entities (a bind parameter would
// defeat them). Anything else falls back to a bound parameter — still correct,
// just not index-accelerated. The strict pattern keeps inlining injection-safe.
const SAFE_FIELD = /^[A-Za-z0-9_]+$/;
function fieldKey(field: string): SQL {
  return SAFE_FIELD.test(field) ? sql.raw(`'${field}'`) : sql`${field}::text`;
}

// Equality condition for one filter entry. Mirrors the client's JS
// `item[key] === value` exactly:
//  - scalars / null: compare the JSON sub-value by type AND value (jsonb `=`),
//    so `5` never matches `"5"` and a filter of `null` only matches a present
//    JSON null (an absent key yields SQL NULL, i.e. no match).
//  - objects/arrays: JS `===` is reference equality, which never matches a
//    freshly parsed filter value, so this is an impossible condition.
function filterCondition(key: string, value: unknown): SQL {
  if (value !== null && typeof value === "object") {
    return sql`false`;
  }
  return sql`${userEntities.data} -> ${fieldKey(key)} = ${JSON.stringify(value)}::jsonb`;
}

function parseSort(sort: string): { field: string; desc: boolean } {
  const desc = sort.startsWith("-");
  return { field: desc ? sort.slice(1) : sort, desc };
}

// ORDER BY parts for a "field" / "-field" sort string. Mirrors the client's JS
// comparator for a HOMOGENEOUS column: numeric compare when the JSON value is a
// number, otherwise a lexical compare ("C" collation = byte order, matching JS
// string `<`), with null/absent values always sorted last regardless of
// direction. (Mixed number/non-number columns can't be expressed as a single
// ORDER BY — see listEntities' fallback.)
function orderByParts(sort: string): SQL[] {
  const { field, desc } = parseSort(sort);
  const key = fieldKey(field);
  const tail = desc ? "desc nulls last" : "asc nulls last";
  return [
    sql`(case when jsonb_typeof(${userEntities.data} -> ${key}) = 'number' then (${userEntities.data} ->> ${key})::numeric end) ${sql.raw(tail)}`,
    sql`(${userEntities.data} ->> ${key}) collate "C" ${sql.raw(tail)}`,
  ];
}

// Exact replica of the client's old in-memory comparator. Used ONLY as a
// fallback for mixed-type sort columns (see sortFieldIsMixed): that comparator
// decides numeric-vs-lexical per PAIR (numeric only when both values are
// numbers), which a single SQL ORDER BY cannot reproduce, so such columns are
// sorted in JS exactly as before. Null/absent always sort last either way.
function compareByField(field: string, desc: boolean) {
  return (a: Record<string, unknown>, b: Record<string, unknown>): number => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    if (av === undefined || av === null) return 1;
    if (bv === undefined || bv === null) return -1;
    let cmp: number;
    if (typeof av === "number" && typeof bv === "number") {
      cmp = av - bv;
    } else {
      cmp = String(av) < String(bv) ? -1 : 1;
    }
    return desc ? -cmp : cmp;
  };
}

// Single source of truth for the limit guard, shared by the SQL and JS paths so
// they stay identical: only a finite, non-negative number truncates the result.
function withinLimit(limit: number | undefined): number | undefined {
  if (typeof limit === "number" && Number.isFinite(limit) && limit >= 0) {
    return Math.trunc(limit);
  }
  return undefined;
}

// Does the sort field hold BOTH a number and a non-number (non-null) JSON value
// across the matching rows? Only then is the old comparator type-dependent per
// pair and impossible to push into a single ORDER BY. Runs only when sorting;
// returns two booleans (no row data) so it stays cheap.
async function sortFieldIsMixed(
  whereClause: SQL,
  field: string,
): Promise<boolean> {
  const key = fieldKey(field);
  const [row] = await db
    .select({
      hasNumber: sql<boolean>`bool_or(jsonb_typeof(${userEntities.data} -> ${key}) = 'number')`,
      hasOther: sql<boolean>`bool_or(jsonb_typeof(${userEntities.data} -> ${key}) in ('string', 'boolean', 'object', 'array'))`,
    })
    .from(userEntities)
    .where(whereClause);
  return Boolean(row?.hasNumber && row?.hasOther);
}

async function listEntities(
  userId: string,
  entityName: string,
  filters: Record<string, unknown> | undefined,
  sort: string | undefined,
  limit: number | undefined,
): Promise<Record<string, unknown>[]> {
  const conditions: SQL[] = [
    eq(userEntities.userId, userId),
    eq(userEntities.entityName, entityName),
  ];
  if (filters && typeof filters === "object") {
    for (const [k, v] of Object.entries(filters)) {
      conditions.push(filterCondition(k, v));
    }
  }
  const whereClause = and(...conditions) as SQL;
  const cap = withinLimit(limit);

  if (typeof sort === "string" && sort) {
    const { field, desc } = parseSort(sort);
    // Mixed-type column: reproduce the old JS comparator exactly. Filters are
    // still applied in SQL; only ordering + limit happen in memory. This path
    // is for pathological data only — in practice a field is consistently typed.
    if (await sortFieldIsMixed(whereClause, field)) {
      const mixedRows = await db
        .select()
        .from(userEntities)
        .where(whereClause);
      const data = mixedRows.map((r) => r.data as Record<string, unknown>);
      data.sort(compareByField(field, desc));
      return cap === undefined ? data : data.slice(0, cap);
    }
  }

  let q = db.select().from(userEntities).where(whereClause).$dynamic();
  if (typeof sort === "string" && sort) {
    q = q.orderBy(...orderByParts(sort));
  }
  if (cap !== undefined) {
    q = q.limit(cap);
  }

  const rows = await q;
  return rows.map((r) => r.data as Record<string, unknown>);
}

async function upsertEntity(
  userId: string,
  entityName: string,
  entityId: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db
    .insert(userEntities)
    .values({ userId, entityName, entityId, data })
    .onConflictDoUpdate({
      target: [
        userEntities.userId,
        userEntities.entityName,
        userEntities.entityId,
      ],
      set: { data, updatedAt: new Date() },
    });
}

// --- Bulk import (one-time local -> server migration) -----------------------
// Body: { entities: { [entityName]: record[] }, profile?: object }
// Only imports when the account has no server data yet, so it cannot clobber
// existing progress or run twice.
router.post("/import", async (req, res) => {
  const userId = getUserId(req);
  const body = req.body as {
    entities?: Record<string, Record<string, unknown>[]>;
    profile?: Record<string, unknown>;
  };

  // Gate ONLY on entities. The sign-in flow creates a profile row (display_name)
  // before this migration runs, so gating on the profile too would wrongly mark
  // the account "not empty" and skip importing legacy entity data on first login.
  const existing = await db
    .select({ id: userEntities.id })
    .from(userEntities)
    .where(eq(userEntities.userId, userId))
    .limit(1);

  if (existing.length > 0) {
    res.json({ imported: false, reason: "account_not_empty" });
    return;
  }

  let count = 0;
  const entities = body.entities || {};
  for (const [entityName, records] of Object.entries(entities)) {
    if (!Array.isArray(records)) continue;
    for (const record of records) {
      if (!record || typeof record !== "object") continue;
      const entityId = String(record.id ?? makeId());
      await upsertEntity(userId, entityName, entityId, {
        ...record,
        id: entityId,
      });
      count += 1;
    }
  }

  // Merge the legacy local profile in WITHOUT clobbering values already set on
  // the server (e.g. the display_name written at sign-in takes precedence).
  if (body.profile && typeof body.profile === "object") {
    const [existingProfile] = await db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1);
    const merged = {
      ...body.profile,
      ...((existingProfile?.data as Record<string, unknown>) ?? {}),
    };
    await db
      .insert(userProfiles)
      .values({ userId, data: merged })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { data: merged, updatedAt: new Date() },
      });
  }

  res.json({ imported: true, count });
});

// --- Restore (backup restore into a possibly non-empty account) -------------
// Body: { entities: { [entityName]: record[] }, profile?: object, mode }
// Unlike /import (which refuses any non-empty account), /restore is the
// user-driven "Restore From Backup" path and works regardless of existing data:
//   - mode "merge":   upsert every backup record by id over the current data,
//                     leaving records not present in the backup untouched. The
//                     backup profile is overlaid on top of the existing profile
//                     (backup values win, existing-only keys are kept).
//   - mode "replace": wipe ALL of the user's existing entities, then insert the
//                     backup, and overwrite the profile with the backup profile.
// Replace runs in a transaction so a failure never leaves the account half-wiped.
router.post("/restore", async (req, res) => {
  const userId = getUserId(req);
  const body = req.body as {
    entities?: Record<string, Record<string, unknown>[]>;
    profile?: Record<string, unknown>;
    mode?: string;
  };

  const mode = body.mode === "replace" ? "replace" : "merge";
  const entities = body.entities;
  if (!entities || typeof entities !== "object" || Array.isArray(entities)) {
    res.status(400).json({ error: "Invalid backup: missing entities" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    if (mode === "replace") {
      await tx.delete(userEntities).where(eq(userEntities.userId, userId));
    }

    let count = 0;
    for (const [entityName, records] of Object.entries(entities)) {
      if (!Array.isArray(records)) continue;
      for (const record of records) {
        if (!record || typeof record !== "object") continue;
        const entityId = String(record.id ?? makeId());
        await tx
          .insert(userEntities)
          .values({ userId, entityName, entityId, data: { ...record, id: entityId } })
          .onConflictDoUpdate({
            target: [
              userEntities.userId,
              userEntities.entityName,
              userEntities.entityId,
            ],
            set: { data: { ...record, id: entityId }, updatedAt: new Date() },
          });
        count += 1;
      }
    }

    if (body.profile && typeof body.profile === "object") {
      const [existingProfile] = await tx
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1);
      // Replace: the backup profile wins outright. Merge: overlay the backup
      // on top of the existing profile so backup values win but existing-only
      // keys (e.g. a display_name the backup lacks) are preserved.
      const merged =
        mode === "replace"
          ? body.profile
          : {
              ...((existingProfile?.data as Record<string, unknown>) ?? {}),
              ...body.profile,
            };
      await tx
        .insert(userProfiles)
        .values({ userId, data: merged })
        .onConflictDoUpdate({
          target: userProfiles.userId,
          set: { data: merged, updatedAt: new Date() },
        });
    }

    return count;
  });

  res.json({ restored: true, mode, count: result });
});

// --- Bulk export ------------------------------------------------------------
// Returns every entity record for the signed-in user, grouped by entity name,
// plus the profile. The shape is the same one /import consumes so a backup can
// be restored after a factory reset (which leaves the account empty).
router.get("/export", async (req, res) => {
  const userId = getUserId(req);

  const rows = await db
    .select()
    .from(userEntities)
    .where(eq(userEntities.userId, userId));

  const entities: Record<string, Record<string, unknown>[]> = {};
  for (const row of rows) {
    const name = row.entityName;
    if (!entities[name]) entities[name] = [];
    entities[name].push(row.data as Record<string, unknown>);
  }

  const [profileRow] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  res.json({
    version: 1,
    exported_at: new Date().toISOString(),
    entities,
    profile: profileRow ? (profileRow.data as Record<string, unknown>) : null,
  });
});

// --- Revision (cheap change token for cross-device live sync) ----------------
// Returns a small token derived from the account's entity row count plus the
// most recent updatedAt (entities and profile). Any create/update/delete shifts
// the token, so a client can poll this one endpoint to detect that something
// changed on another device without refetching every entity. It is intentionally
// O(1)-ish (a single aggregate query + a profile lookup), unlike /export.
router.get("/revision", async (req, res) => {
  const userId = getUserId(req);

  // extract(epoch ...) keeps sub-millisecond (microsecond) precision as text so
  // two writes in the same millisecond still shift the token. ::text avoids any
  // driver-dependent Date parsing that could truncate precision.
  const [agg] = await db
    .select({
      count: sql<number>`count(*)::int`,
      maxEpoch: sql<string>`coalesce(extract(epoch from max(${userEntities.updatedAt}))::text, '0')`,
    })
    .from(userEntities)
    .where(eq(userEntities.userId, userId));

  const [profile] = await db
    .select({
      epoch: sql<string>`coalesce(extract(epoch from ${userProfiles.updatedAt})::text, '0')`,
    })
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);

  const count = agg?.count ?? 0;
  const entitiesRev = agg?.maxEpoch ?? "0";
  const profileRev = profile?.epoch ?? "0";

  res.json({ revision: `${count}:${entitiesRev}:${profileRev}` });
});

// --- Profile (per-user settings record) -------------------------------------
router.get("/profile", async (req, res) => {
  const userId = getUserId(req);
  const [row] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, userId))
    .limit(1);
  res.json(row ? (row.data as Record<string, unknown>) : null);
});

router.put("/profile", async (req, res) => {
  const userId = getUserId(req);
  const data = (req.body ?? {}) as Record<string, unknown>;
  const [row] = await db
    .insert(userProfiles)
    .values({ userId, data })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { data, updatedAt: new Date() },
    })
    .returning();
  res.json(row.data as Record<string, unknown>);
});

// --- Bulk create ------------------------------------------------------------
router.post("/:entity/bulk", async (req, res) => {
  const userId = getUserId(req);
  const { entity } = req.params;
  const items = (req.body?.items ?? []) as Record<string, unknown>[];
  const now = new Date().toISOString();
  const created: Record<string, unknown>[] = [];
  for (const data of items) {
    const id = makeId();
    const record = {
      id,
      created_date: now,
      updated_date: now,
      ...data,
    };
    await upsertEntity(userId, entity, id, record);
    created.push(record);
  }
  res.status(201).json(created);
});

// --- List / filter ----------------------------------------------------------
router.get("/:entity", async (req, res) => {
  const userId = getUserId(req);
  const { entity } = req.params;
  const sort =
    typeof req.query.sort === "string" ? req.query.sort : undefined;
  const limit =
    typeof req.query.limit === "string" && req.query.limit !== ""
      ? Number(req.query.limit)
      : undefined;
  let filters: Record<string, unknown> | undefined;
  if (typeof req.query.filters === "string" && req.query.filters) {
    try {
      filters = JSON.parse(req.query.filters);
    } catch {
      filters = undefined;
    }
  }
  const items = await listEntities(userId, entity, filters, sort, limit);
  res.json(items);
});

// --- Get one ----------------------------------------------------------------
router.get("/:entity/:id", async (req, res) => {
  const userId = getUserId(req);
  const { entity, id } = req.params;
  const [row] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, entity),
        eq(userEntities.entityId, id),
      ),
    )
    .limit(1);
  res.json(row ? (row.data as Record<string, unknown>) : null);
});

// --- Create -----------------------------------------------------------------
router.post("/:entity", async (req, res) => {
  const userId = getUserId(req);
  const { entity } = req.params;
  const data = (req.body ?? {}) as Record<string, unknown>;
  const id = makeId();
  const now = new Date().toISOString();
  const record = {
    id,
    created_date: now,
    updated_date: now,
    ...data,
  };
  await upsertEntity(userId, entity, id, record);
  res.status(201).json(record);
});

// --- Update (upsert) --------------------------------------------------------
router.put("/:entity/:id", async (req, res) => {
  const userId = getUserId(req);
  const { entity, id } = req.params;
  const data = (req.body ?? {}) as Record<string, unknown>;

  const [existing] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, entity),
        eq(userEntities.entityId, id),
      ),
    )
    .limit(1);

  const now = new Date().toISOString();
  let record: Record<string, unknown>;
  if (existing) {
    const prev = existing.data as Record<string, unknown>;
    record = { ...prev, ...data, id, updated_date: now };
  } else {
    record = {
      id,
      created_date: now,
      updated_date: now,
      ...data,
    };
  }
  await upsertEntity(userId, entity, id, record);
  res.json(record);
});

// --- Delete -----------------------------------------------------------------
router.delete("/:entity/:id", async (req, res) => {
  const userId = getUserId(req);
  const { entity, id } = req.params;
  await db
    .delete(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, entity),
        eq(userEntities.entityId, id),
      ),
    );
  res.status(204).send();
});

export default router;
