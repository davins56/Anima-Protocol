import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, userEntities, userProfiles } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
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

// Apply the SDK-style querying the client relies on: optional equality filters,
// a sort string ("field" ascending, "-field" descending) and a numeric limit.
function applyQuery(
  items: Record<string, unknown>[],
  filters: Record<string, unknown> | undefined,
  sort: string | undefined,
  limit: number | undefined,
): Record<string, unknown>[] {
  let result = items;

  if (filters && typeof filters === "object") {
    const entries = Object.entries(filters);
    if (entries.length) {
      result = result.filter((item) =>
        entries.every(([k, v]) => item[k] === v),
      );
    }
  }

  if (typeof sort === "string" && sort) {
    const desc = sort.startsWith("-");
    const field = desc ? sort.slice(1) : sort;
    result = [...result].sort((a, b) => {
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
    });
  }

  if (typeof limit === "number" && limit >= 0) {
    result = result.slice(0, limit);
  }

  return result;
}

async function listEntities(
  userId: string,
  entityName: string,
): Promise<Record<string, unknown>[]> {
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, entityName),
      ),
    );
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
  const items = await listEntities(userId, entity);
  res.json(applyQuery(items, filters, sort, limit));
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
