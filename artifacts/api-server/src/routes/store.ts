import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, userEntities, userProfiles } from "@workspace/db";
import { and, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import { addClient, removeClient, notifyUser } from "../lib/storeEvents";

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

// Push notifier: after ANY successful mutating request, signal the user's open
// SSE streams that their store changed. Hooking res "finish" (rather than
// instrumenting each route) means every current and future write path is
// covered automatically. GETs (including the SSE stream and /export) and any
// 4xx/5xx are ignored, so reads and failed writes never emit a signal.
function notifyOnWrite(req: Request, res: Response, next: NextFunction): void {
  const method = req.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    next();
    return;
  }
  res.on("finish", () => {
    if (res.statusCode < 400) {
      notifyUser(getUserId(req));
    }
  });
  next();
}

router.use(notifyOnWrite);

// --- Live push stream (SSE) -------------------------------------------------
// An authenticated Server-Sent Events stream. The client opens it while signed
// in and re-checks /revision whenever a "change" event arrives, making remote
// updates appear near-instantly instead of waiting for the next poll. The
// payload is just a nudge — real change detection / self-write suppression
// still happens client-side against /revision, so this is safe to fan out to
// all of a user's devices (including the one that made the write).
router.get("/events", (req: Request, res: Response) => {
  const userId = getUserId(req);

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // Defeat proxy/buffering layers that would otherwise hold the stream.
    "X-Accel-Buffering": "no",
  });
  // Initial comment flushes headers and confirms the stream is live.
  res.write(": connected\n\n");

  addClient(userId, res);

  // Heartbeat keeps idle connections alive through proxy/idle timeouts and lets
  // the client detect a dead stream so it can fall back to polling.
  const heartbeat = setInterval(() => {
    try {
      res.write(": hb\n\n");
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  req.on("close", () => {
    clearInterval(heartbeat);
    removeClient(userId, res);
  });
});

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

// Case-insensitive substring match on a JSON text field, mirroring the client's
// old in-memory `item[field]?.toLowerCase().includes(term.toLowerCase())`: an
// absent/non-string value never matches, and the term is matched literally
// (its LIKE wildcards are escaped) anywhere within the value. Pushed into SQL so
// search applies across the WHOLE history, not just the page already loaded.
function searchCondition(field: string, term: string): SQL {
  const escaped = term.replace(/[\\%_]/g, (c) => `\\${c}`);
  return sql`(${userEntities.data} ->> ${fieldKey(field)}) ilike ${`%${escaped}%`}`;
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

// Offset guard, mirroring withinLimit: a finite, positive number skips that many
// leading rows; anything else means "no offset" (0). Pushed into SQL so paging
// to a later page fetches only that page's rows instead of every row up to it.
function withinOffset(offset: number | undefined): number {
  if (typeof offset === "number" && Number.isFinite(offset) && offset > 0) {
    return Math.trunc(offset);
  }
  return 0;
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
  offset: number | undefined,
  search: Record<string, unknown> | undefined,
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
  if (search && typeof search === "object") {
    for (const [k, v] of Object.entries(search)) {
      // Only non-empty string terms add a constraint; anything else is a no-op
      // so an empty search box returns the full (paged) list unchanged.
      if (typeof v === "string" && v !== "") {
        conditions.push(searchCondition(k, v));
      }
    }
  }
  const whereClause = and(...conditions) as SQL;
  const cap = withinLimit(limit);
  const off = withinOffset(offset);

  if (typeof sort === "string" && sort) {
    const { field, desc } = parseSort(sort);
    // Mixed-type column: reproduce the old JS comparator exactly. Filters are
    // still applied in SQL; only ordering + limit + offset happen in memory.
    // This path is for pathological data only — in practice a field is
    // consistently typed.
    if (await sortFieldIsMixed(whereClause, field)) {
      const mixedRows = await db
        .select()
        .from(userEntities)
        .where(whereClause);
      const data = mixedRows.map((r) => r.data as Record<string, unknown>);
      data.sort(compareByField(field, desc));
      const end = cap === undefined ? undefined : off + cap;
      return off > 0 || end !== undefined ? data.slice(off, end) : data;
    }
  }

  let q = db.select().from(userEntities).where(whereClause).$dynamic();
  if (typeof sort === "string" && sort) {
    q = q.orderBy(...orderByParts(sort));
  }
  if (cap !== undefined) {
    q = q.limit(cap);
  }
  if (off > 0) {
    q = q.offset(off);
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
      // ChatMessage rows are NOT a plain upsert-by-id (see below): merging a
      // backup whose message ids differ from the local ones would insert them
      // ALONGSIDE the local rows, leaving two interleaved sets that share the
      // same per-session seq values. They are restored separately, per session.
      if (entityName === CHAT_MESSAGE) continue;
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

    // Chat messages are keyed by their own message id and ordered by a
    // per-session integer `seq`. Restoring them wholesale per session keeps the
    // history single and gapless:
    //   - merge: for every session the backup contains, delete that session's
    //     existing ChatMessage rows first so the backup REPLACES them rather
    //     than interleaving (which would duplicate seq). Sessions the backup
    //     never mentions are left untouched, preserving merge semantics.
    //   - replace: the whole table was already wiped above, so just insert.
    // Either way the backup's messages are re-seq'd 0..n-1 by their stored seq,
    // guaranteeing a gapless, unambiguous order regardless of the source.
    const chatRecords = entities[CHAT_MESSAGE];
    if (Array.isArray(chatRecords)) {
      const bySession = new Map<string, MsgData[]>();
      for (const record of chatRecords) {
        if (!record || typeof record !== "object") continue;
        const sessionId = String((record as MsgData).session_id ?? "");
        if (!sessionId) continue;
        const list = bySession.get(sessionId);
        if (list) list.push(record as MsgData);
        else bySession.set(sessionId, [record as MsgData]);
      }
      for (const [sessionId, msgs] of bySession) {
        if (mode === "merge") {
          await tx
            .delete(userEntities)
            .where(
              and(
                eq(userEntities.userId, userId),
                eq(userEntities.entityName, CHAT_MESSAGE),
                sessionIdEq(sessionId),
              ),
            );
        }
        msgs.sort((a, b) => Number(a.seq ?? 0) - Number(b.seq ?? 0));
        let i = 0;
        for (const msg of msgs) {
          const entityId = String(msg.id ?? makeId());
          const data: MsgData = {
            ...msg,
            id: entityId,
            session_id: sessionId,
            seq: i,
          };
          await tx
            .insert(userEntities)
            .values({ userId, entityName: CHAT_MESSAGE, entityId, data })
            .onConflictDoUpdate({
              target: [
                userEntities.userId,
                userEntities.entityName,
                userEntities.entityId,
              ],
              set: { data, updatedAt: new Date() },
            });
          count += 1;
          i += 1;
        }
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

// --- Chat messages (stored as individual rows) ------------------------------
// Chat messages used to live as one big JSONB `messages` array on each
// ChatSession record, so every append/edit rewrote the whole history and reads
// loaded all of it. They now live as their own rows (entity_name 'ChatMessage')
// keyed by `session_id` and ordered by a per-session integer `seq`, so an
// append inserts ONE row, reads can page, and the chat UI is otherwise
// unchanged. Existing sessions are migrated transparently on first access.
//
// These routes are registered before the generic /:entity routes so the literal
// "messages" segment wins over the entity wildcard.
const CHAT_MESSAGE = "ChatMessage";
const CHAT_SESSION = "ChatSession";

// `data ->> 'session_id' = '<id>'` — scope a ChatMessage to exactly one session.
// session_id is always a string, so this text comparison is equivalent to the
// jsonb equality used by the generic filter, and it deliberately mirrors the
// text projection of user_entities_session_seq_idx (and the batch read at
// inArray below) so seq-ordered message reads stay index-accelerated.
function sessionIdEq(sessionId: string): SQL {
  return sql`(${userEntities.data} ->> 'session_id') = ${sessionId}`;
}

type Row = typeof userEntities.$inferSelect;
type MsgData = Record<string, unknown>;

function asObject(m: unknown): MsgData {
  return m && typeof m === "object" && !Array.isArray(m)
    ? (m as MsgData)
    : { content: m == null ? "" : String(m) };
}

// Lazily split a legacy ChatSession.messages blob into ChatMessage rows the
// first time a session's messages are touched, then clear the blob and flag the
// session migrated. Runs inside the caller's transaction so it is atomic, and is
// idempotent: the `messages_migrated` flag short-circuits subsequent calls, and
// the existing-rows guard avoids double-inserting if a flag was ever lost.
async function ensureSessionMigrated(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  sessionId: string,
): Promise<void> {
  // Serialize everything that touches one session's message stream within its
  // transaction: migration, and (because append/replace call this first) seq
  // assignment. This makes concurrent appends to the same session strictly
  // ordered (no duplicate seq) and concurrent first-reads migrate exactly once,
  // without a unique constraint that would surface as a client-visible failure.
  // The lock is keyed per (user, session) and auto-releases at transaction end,
  // and since each transaction locks exactly one pair there is no deadlock risk.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${userId}), hashtext(${sessionId}))`,
  );

  const [session] = await tx
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        eq(userEntities.entityId, sessionId),
      ),
    )
    .limit(1);
  if (!session) return;
  const data = session.data as MsgData;
  if (data.messages_migrated) return;

  const blob = Array.isArray(data.messages) ? (data.messages as unknown[]) : [];
  const now = new Date().toISOString();

  if (blob.length > 0) {
    const existing = await tx
      .select({ id: userEntities.id })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(sessionId),
        ),
      )
      .limit(1);
    if (existing.length === 0) {
      let i = 0;
      for (const raw of blob) {
        const msg = asObject(raw);
        const id = String(msg.id ?? makeId());
        await tx.insert(userEntities).values({
          userId,
          entityName: CHAT_MESSAGE,
          entityId: id,
          data: {
            ...msg,
            id,
            session_id: sessionId,
            seq: i,
            created_date: msg.created_date ?? msg.timestamp ?? now,
            updated_date: now,
          },
        });
        i += 1;
      }
    }
  }

  const { messages: _omit, ...rest } = data;
  await tx
    .update(userEntities)
    .set({
      data: { ...rest, messages: [], messages_migrated: true },
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        eq(userEntities.entityId, sessionId),
      ),
    );
}

// Read one session's messages ordered by seq. Paging contract:
//   (no limit)            -> the whole history, ascending seq
//   limit=N               -> the most recent N messages, ascending seq
//   limit=N & before_seq  -> the N messages with seq < before_seq, ascending
// "most recent N" is fetched desc+limit then reversed so the client always gets
// chronological order regardless of which page it asked for.
async function readMessages(
  userId: string,
  sessionId: string,
  limit: number | undefined,
  beforeSeq: number | undefined,
): Promise<MsgData[]> {
  const conds: SQL[] = [
    eq(userEntities.userId, userId),
    eq(userEntities.entityName, CHAT_MESSAGE),
    sessionIdEq(sessionId),
  ];
  if (beforeSeq !== undefined) {
    conds.push(sql`(${userEntities.data} ->> 'seq')::numeric < ${beforeSeq}`);
  }
  const cap = withinLimit(limit);
  if (cap === undefined) {
    const rows = await db
      .select()
      .from(userEntities)
      .where(and(...conds))
      .orderBy(sql`(${userEntities.data} ->> 'seq')::numeric asc`);
    return rows.map((r) => r.data as MsgData);
  }
  const rows = await db
    .select()
    .from(userEntities)
    .where(and(...conds))
    .orderBy(sql`(${userEntities.data} ->> 'seq')::numeric desc`)
    .limit(cap);
  return rows.map((r) => r.data as MsgData).reverse();
}

// GET /messages?session_id=&limit=&before_seq= — paged read (migrates on first
// access). Returned messages are always in ascending seq (chronological) order.
router.get("/messages", async (req, res) => {
  const userId = getUserId(req);
  const sessionId =
    typeof req.query.session_id === "string" ? req.query.session_id : "";
  if (!sessionId) {
    res.status(400).json({ error: "session_id is required" });
    return;
  }
  const limit =
    typeof req.query.limit === "string" && req.query.limit !== ""
      ? Number(req.query.limit)
      : undefined;
  const beforeSeq =
    typeof req.query.before_seq === "string" && req.query.before_seq !== ""
      ? Number(req.query.before_seq)
      : undefined;

  await db.transaction((tx) => ensureSessionMigrated(tx, userId, sessionId));
  const messages = await readMessages(userId, sessionId, limit, beforeSeq);
  res.json(messages);
});

// POST /messages/by-sessions { ids: [] } — batch hydration for the client's
// transparent ChatSession.list()/get() message attachment. Migrates each
// session then returns { [sessionId]: message[] } in one query.
router.post("/messages/by-sessions", async (req, res) => {
  const userId = getUserId(req);
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map(String)
    : [];
  const bySession: Record<string, MsgData[]> = {};
  for (const id of ids) bySession[id] = [];
  if (ids.length === 0) {
    res.json(bySession);
    return;
  }

  for (const sid of ids) {
    await db.transaction((tx) => ensureSessionMigrated(tx, userId, sid));
  }

  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        inArray(sql`(${userEntities.data} ->> 'session_id')`, ids),
      ),
    )
    .orderBy(sql`(${userEntities.data} ->> 'seq')::numeric asc`);

  for (const r of rows) {
    const d = r.data as MsgData;
    const sid = String(d.session_id);
    if (!bySession[sid]) bySession[sid] = [];
    bySession[sid].push(d);
  }
  res.json(bySession);
});

// POST /messages/counts { ids: [] } — batch message COUNT per session. Backs
// metadata-only lists (e.g. the Y/n Stories Library cards and Lore Archives'
// XP/rank totals) that need each session's message total without hydrating the
// full history. Migrates each session first (same as by-sessions) so a legacy
// blob session reports an accurate count, then returns { [sessionId]: number }
// from one grouped query.
router.post("/messages/counts", async (req, res) => {
  const userId = getUserId(req);
  const ids = Array.isArray(req.body?.ids)
    ? (req.body.ids as unknown[]).map(String)
    : [];
  const counts: Record<string, number> = {};
  for (const id of ids) counts[id] = 0;
  if (ids.length === 0) {
    res.json(counts);
    return;
  }

  for (const sid of ids) {
    await db.transaction((tx) => ensureSessionMigrated(tx, userId, sid));
  }

  const rows = await db
    .select({
      sid: sql<string>`(${userEntities.data} ->> 'session_id')`,
      count: sql<number>`count(*)::int`,
    })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        inArray(sql`(${userEntities.data} ->> 'session_id')`, ids),
      ),
    )
    .groupBy(sql`(${userEntities.data} ->> 'session_id')`);

  for (const r of rows) {
    counts[String(r.sid)] = Number(r.count) || 0;
  }
  res.json(counts);
});

// POST /messages { session_id, message } — append ONE message. The server
// assigns the next seq atomically (within a transaction) so an append never has
// to send or rewrite the existing history. This is the hot path.
router.post("/messages", async (req, res) => {
  const userId = getUserId(req);
  const body = req.body as { session_id?: string; message?: unknown };
  const sessionId = body.session_id;
  if (!sessionId || !body.message) {
    res.status(400).json({ error: "session_id and message are required" });
    return;
  }
  const created = await db.transaction(async (tx) => {
    await ensureSessionMigrated(tx, userId, sessionId);
    const [agg] = await tx
      .select({
        maxSeq: sql<string>`coalesce(max((${userEntities.data} ->> 'seq')::numeric), -1)`,
      })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(sessionId),
        ),
      );
    const seq = Number(agg?.maxSeq ?? -1) + 1;
    const now = new Date().toISOString();
    const msg = asObject(body.message);
    const id = String(msg.id ?? makeId());
    const data: MsgData = {
      ...msg,
      id,
      session_id: sessionId,
      seq,
      created_date: msg.created_date ?? now,
      updated_date: now,
    };
    await tx.insert(userEntities).values({
      userId,
      entityName: CHAT_MESSAGE,
      entityId: id,
      data,
    });
    return data;
  });
  res.status(201).json(created);
});

// POST /messages/replace { session_id, messages } — reconcile a full message
// array against the stored rows. Backs the client's ChatSession.update({messages})
// compatibility shim so the existing edit/delete/rewind flows keep working
// unchanged. It diffs by message id so an edit updates ONE row, a rewind deletes
// only the trimmed tail, etc. (rather than rewriting every row), and reassigns
// seq by array position so order always follows the array.
router.post("/messages/replace", async (req, res) => {
  const userId = getUserId(req);
  const body = req.body as { session_id?: string; messages?: unknown };
  const sessionId = body.session_id;
  if (!sessionId || !Array.isArray(body.messages)) {
    res.status(400).json({ error: "session_id and messages[] are required" });
    return;
  }
  const incoming = body.messages as unknown[];
  const out = await db.transaction(async (tx) => {
    await ensureSessionMigrated(tx, userId, sessionId);
    const current: Row[] = await tx
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(sessionId),
        ),
      );
    const currentById = new Map<string, Row>();
    for (const r of current) currentById.set(String((r.data as MsgData).id), r);

    const now = new Date().toISOString();
    const kept = new Set<string>();
    const result: MsgData[] = [];
    let i = 0;
    for (const raw of incoming) {
      const msg = asObject(raw);
      const existingId =
        msg.id != null && currentById.has(String(msg.id))
          ? String(msg.id)
          : null;
      const id = existingId ?? String(msg.id ?? makeId());
      const prev = existingId
        ? (currentById.get(existingId)!.data as MsgData)
        : null;
      const data: MsgData = {
        ...msg,
        id,
        session_id: sessionId,
        seq: i,
        created_date: prev?.created_date ?? msg.created_date ?? now,
        updated_date: now,
      };
      await tx
        .insert(userEntities)
        .values({ userId, entityName: CHAT_MESSAGE, entityId: id, data })
        .onConflictDoUpdate({
          target: [
            userEntities.userId,
            userEntities.entityName,
            userEntities.entityId,
          ],
          set: { data, updatedAt: new Date() },
        });
      kept.add(id);
      result.push(data);
      i += 1;
    }
    for (const r of current) {
      const rid = String((r.data as MsgData).id);
      if (!kept.has(rid)) {
        await tx
          .delete(userEntities)
          .where(
            and(
              eq(userEntities.userId, userId),
              eq(userEntities.entityName, CHAT_MESSAGE),
              eq(userEntities.entityId, rid),
            ),
          );
      }
    }
    return result;
  });
  res.json(out);
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
  const offset =
    typeof req.query.offset === "string" && req.query.offset !== ""
      ? Number(req.query.offset)
      : undefined;
  let filters: Record<string, unknown> | undefined;
  if (typeof req.query.filters === "string" && req.query.filters) {
    try {
      filters = JSON.parse(req.query.filters);
    } catch {
      filters = undefined;
    }
  }
  let search: Record<string, unknown> | undefined;
  if (typeof req.query.search === "string" && req.query.search) {
    try {
      search = JSON.parse(req.query.search);
    } catch {
      search = undefined;
    }
  }
  const items = await listEntities(
    userId,
    entity,
    filters,
    sort,
    limit,
    offset,
    search,
  );
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
