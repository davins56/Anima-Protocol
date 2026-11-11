/**
 * Dream journal API (docs/dream-journal-frontend-contract.md). Read-only over
 * the append-only `dreams` table; reads go to `dream_reads`, the opt-out to
 * `dream_settings`.
 *
 *   GET  /api/dreams/:characterId?limit=&cursor=
 *   GET  /api/dreams/:characterId/settings
 *   PUT  /api/dreams/:characterId/settings   { dreaming_enabled: boolean }
 *   GET  /api/dreams/:characterId/:dreamId
 *   POST /api/dreams/:characterId/:dreamId/read
 */
import { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { getPool } from "@workspace/db";
import { rateLimit } from "../lib/rateLimit";
import { characterOwnedBy } from "../lib/memoryCore/characterOwnedBy";
import { presenceState } from "../lib/continuity/continuityCore";
import { loadCompanionState } from "../lib/continuity/continuityStore";
import { dreamConfig } from "../lib/dreams/dreamCore";
import { dreamingEnabledFor } from "../lib/dreams/dreamLayer";

const router = Router();
router.use(rateLimit);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

type DreamRow = {
  id: string;
  created_at: string;
  mood: string | null;
  themes: string[] | null;
  summary: string;
  fragment: string;
  read: boolean;
  surfaced_count: number;
  created_raw?: string;
};

function isMissingSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "42P01" || /(dreams|dream_reads|dream_settings|dream_surfacings).* does not exist/i.test(String(e?.message || ""));
}

function fail(res: Response, err: unknown): void {
  if (isMissingSchema(err)) {
    res.status(503).json({ error: "Dream journal is not set up yet.", code: "dream_schema_missing" });
    return;
  }
  console.warn("[dreams] request failed:", (err as Error)?.message);
  res.status(500).json({ error: "Dream journal request failed.", code: "server_error" });
}

function requireUser(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized", code: "unauthorized" });
    return null;
  }
  return userId;
}

/** Authenticates and confirms ownership; sends the error response and returns null otherwise. */
async function authorize(req: Request, res: Response): Promise<{ userId: string; characterId: string } | null> {
  res.setHeader("Cache-Control", "private, no-store");
  const userId = requireUser(req, res);
  if (!userId) return null;
  const characterId = String(req.params.characterId || "");
  const notFound = () => res.status(404).json({ error: "Companion not found", code: "companion_not_found" });
  if (!characterId || characterId.length > 120 || !(await characterOwnedBy(userId, characterId))) {
    notFound();
    return null;
  }
  return { userId, characterId };
}

function encodeCursor(createdRaw: string, id: string): string {
  return Buffer.from(JSON.stringify([createdRaw, id])).toString("base64url");
}

function decodeCursor(raw: string): { createdAt: string; id: string } | null {
  try {
    const [createdAt, id] = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (typeof createdAt !== "string" || typeof id !== "string" || !UUID.test(id) || Number.isNaN(Date.parse(createdAt))) return null;
    return { createdAt, id };
  } catch {
    return null;
  }
}

// Only public fields: never source_event_ids, synthesizer or model.
const SELECT_DREAM = `
  SELECT d.id, d.created_at::text AS created_raw, d.mood, d.themes, d.summary, d.fragment,
         EXISTS (SELECT 1 FROM dream_reads r WHERE r.dream_id = d.id AND r.user_id = d.user_id) AS read,
         (SELECT count(*) FROM dream_surfacings s WHERE s.dream_id = d.id)::int AS surfaced_count
  FROM dreams d`;

function shape(r: DreamRow) {
  return {
    id: r.id,
    created_at: new Date(r.created_raw ?? r.created_at).toISOString(),
    mood: r.mood,
    themes: r.themes ?? [],
    summary: r.summary,
    fragment: r.fragment,
    read: Boolean(r.read),
    surfaced_count: Number(r.surfaced_count) || 0,
  };
}

async function unreadCount(userId: string, characterId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM dreams d
      WHERE d.user_id = $1 AND d.character_id = $2
        AND NOT EXISTS (SELECT 1 FROM dream_reads r WHERE r.dream_id = d.id AND r.user_id = d.user_id)`,
    [userId, characterId],
  );
  return rows[0]?.n ?? 0;
}

async function isDreaming(userId: string, characterId: string): Promise<boolean> {
  try {
    const state = await loadCompanionState(userId, characterId);
    return (
      presenceState({
        lastInteractionAt: state.lastInteractionAt,
        lastDreamAt: state.lastDreamAt,
        inactivityMinutes: dreamConfig().inactivityMinutes,
      }) === "dreaming"
    );
  } catch {
    return false;
  }
}

router.get("/:characterId/settings", async (req, res) => {
  try {
    const auth = await authorize(req, res);
    if (!auth) return;
    res.json({ character_id: auth.characterId, dreaming_enabled: await dreamingEnabledFor(auth.userId, auth.characterId) });
  } catch (err) {
    fail(res, err);
  }
});

router.put("/:characterId/settings", async (req, res) => {
  try {
    const auth = await authorize(req, res);
    if (!auth) return;
    const enabled = (req.body as { dreaming_enabled?: unknown } | undefined)?.dreaming_enabled;
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "dreaming_enabled must be a boolean", code: "invalid_body" });
      return;
    }
    await getPool().query(
      `INSERT INTO dream_settings (user_id, character_id, dreaming_enabled) VALUES ($1,$2,$3)
       ON CONFLICT (user_id, character_id) DO UPDATE SET dreaming_enabled = EXCLUDED.dreaming_enabled, updated_at = now()`,
      [auth.userId, auth.characterId, enabled],
    );
    res.json({ character_id: auth.characterId, dreaming_enabled: enabled });
  } catch (err) {
    fail(res, err);
  }
});

router.get("/:characterId", async (req, res) => {
  try {
    const auth = await authorize(req, res);
    if (!auth) return;
    const { userId, characterId } = auth;

    const limitRaw = req.query.limit;
    const parsed = limitRaw == null || limitRaw === "" ? DEFAULT_LIMIT : Number(limitRaw);
    const limit = Number.isFinite(parsed) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(parsed))) : DEFAULT_LIMIT;

    let cursor: { createdAt: string; id: string } | null = null;
    if (typeof req.query.cursor === "string" && req.query.cursor) {
      cursor = decodeCursor(req.query.cursor);
      if (!cursor) {
        res.status(400).json({ error: "Invalid cursor", code: "invalid_cursor" });
        return;
      }
    }

    const params: unknown[] = [userId, characterId, limit + 1];
    let where = "d.user_id = $1 AND d.character_id = $2";
    if (cursor) {
      params.push(cursor.createdAt, cursor.id);
      where += " AND (d.created_at, d.id) < ($4::timestamptz, $5::uuid)";
    }
    const { rows } = await getPool().query<DreamRow>(
      `${SELECT_DREAM} WHERE ${where} ORDER BY d.created_at DESC, d.id DESC LIMIT $3`,
      params,
    );
    const page = rows.slice(0, limit);
    const last = page[page.length - 1];
    const [enabled, unread, dreaming] = await Promise.all([
      dreamingEnabledFor(userId, characterId),
      unreadCount(userId, characterId),
      isDreaming(userId, characterId),
    ]);
    res.json({
      character_id: characterId,
      dreaming_enabled: enabled,
      unread_count: unread,
      is_dreaming: dreaming,
      dreams: page.map(shape),
      next_cursor: rows.length > limit && last ? encodeCursor(last.created_raw!, last.id) : null,
    });
  } catch (err) {
    fail(res, err);
  }
});

async function loadDream(userId: string, characterId: string, dreamId: string): Promise<DreamRow | null> {
  if (!UUID.test(dreamId)) return null;
  const { rows } = await getPool().query<DreamRow>(
    `${SELECT_DREAM} WHERE d.id = $1 AND d.user_id = $2 AND d.character_id = $3`,
    [dreamId, userId, characterId],
  );
  return rows[0] ?? null;
}

const dreamNotFound = (res: Response) => res.status(404).json({ error: "Dream not found", code: "dream_not_found" });

router.get("/:characterId/:dreamId", async (req, res) => {
  try {
    const auth = await authorize(req, res);
    if (!auth) return;
    const row = await loadDream(auth.userId, auth.characterId, String(req.params.dreamId));
    if (!row) return void dreamNotFound(res);
    res.json(shape(row));
  } catch (err) {
    fail(res, err);
  }
});

router.post("/:characterId/:dreamId/read", async (req, res) => {
  try {
    const auth = await authorize(req, res);
    if (!auth) return;
    const row = await loadDream(auth.userId, auth.characterId, String(req.params.dreamId));
    if (!row) return void dreamNotFound(res);
    await getPool().query(
      `INSERT INTO dream_reads (dream_id, user_id, character_id) VALUES ($1,$2,$3) ON CONFLICT (user_id, dream_id) DO NOTHING`,
      [row.id, auth.userId, auth.characterId],
    );
    res.json({ ok: true, unread_count: await unreadCount(auth.userId, auth.characterId) });
  } catch (err) {
    fail(res, err);
  }
});

export default router;
