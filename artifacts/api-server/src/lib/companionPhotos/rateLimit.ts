/**
 * Per-user photo limits (photos cost Workers AI neurons). Counts the photos
 * this user was actually sent, from the chat-turn ledger (`chat_turns.metadata
 * .companion_photo.status = 'sent'`, indexed by user_id), plus photos still
 * generating in this isolate. No new table.
 *
 * If the count query fails, only the in-isolate counter applies (the limit is
 * about cost, not safety).
 */
import { getPool } from "@workspace/db";

export type PhotoUsage = { hour: number; day: number };
export type PhotoLimitResult = { allowed: true } | { allowed: false; window: "hour" | "day" };

const inflight = new Map<string, number>();
const recent = new Map<string, number[]>();
/** In-isolate last unprompted (tag) photo, keyed by user:character:session. */
const lastSpontaneous = new Map<string, number>();

export function spontaneousKey(userId: string, characterId: string, sessionId = ""): string {
  return `${userId}:${characterId}:${sessionId}`;
}

export function noteSpontaneousSent(userId: string, characterId: string, sessionId = "", now = Date.now()): void {
  lastSpontaneous.set(spontaneousKey(userId, characterId, sessionId), now);
}

export function spontaneousRecentlySent(
  userId: string,
  characterId: string,
  sessionId: string,
  cooldownMs: number,
  now = Date.now(),
): boolean {
  const at = lastSpontaneous.get(spontaneousKey(userId, characterId, sessionId));
  return at != null && now - at < cooldownMs;
}

export type SpontaneousState = {
  lastAt: number | null;
  exchangesSince: number;
  /** False when the ledger query failed and exchange count is unknown. */
  exchangesKnown: boolean;
};

export function checkSpontaneousCooldown(
  state: SpontaneousState | null | undefined,
  limits: { spontaneousMinExchanges: number; spontaneousCooldownMs: number },
  now = Date.now(),
): boolean {
  if (!state || state.lastAt == null) return true;
  if (now - state.lastAt < limits.spontaneousCooldownMs) return false;
  if (!state.exchangesKnown) return true;
  if (state.exchangesSince < limits.spontaneousMinExchanges) return false;
  return true;
}

export async function spontaneousState(
  userId: string,
  characterId: string,
  sessionId: string,
  _now = Date.now(),
): Promise<SpontaneousState> {
  const localAt = lastSpontaneous.get(spontaneousKey(userId, characterId, sessionId)) ?? null;
  try {
    const { rows } = await getPool().query<{ last_at: Date | string | null; exchanges: string | number }>(
      `SELECT (
                SELECT created_at
                  FROM chat_turns
                 WHERE user_id = $1
                   AND session_id = $2
                   AND metadata ->> 'active_character_id' = $3
                   AND metadata -> 'companion_photo' ->> 'status' = 'sent'
                   AND (
                     metadata -> 'companion_photo' ->> 'source' = 'tag'
                     OR metadata -> 'companion_photo' ->> 'trigger' = 'spontaneous'
                   )
                 ORDER BY created_at DESC
                 LIMIT 1
              ) AS last_at,
              (
                SELECT count(*)
                  FROM chat_turns later
                 WHERE later.user_id = $1
                   AND later.session_id = $2
                   AND later.created_at > COALESCE(
                     (
                       SELECT created_at
                         FROM chat_turns
                        WHERE user_id = $1
                          AND session_id = $2
                          AND metadata ->> 'active_character_id' = $3
                          AND metadata -> 'companion_photo' ->> 'status' = 'sent'
                          AND (
                            metadata -> 'companion_photo' ->> 'source' = 'tag'
                            OR metadata -> 'companion_photo' ->> 'trigger' = 'spontaneous'
                          )
                        ORDER BY created_at DESC
                        LIMIT 1
                     ),
                     '-infinity'::timestamp
                   )
              ) AS exchanges`,
      [userId, sessionId, characterId],
    );
    const row = rows[0];
    const lastAt = row?.last_at ? new Date(row.last_at).getTime() : localAt;
    const exchanges = row?.last_at ? Number(row.exchanges) : (localAt ? 0 : Number.POSITIVE_INFINITY);
    return {
      lastAt: Number.isFinite(lastAt as number) ? (lastAt as number) : localAt,
      exchangesSince: Number.isFinite(exchanges) ? exchanges : 0,
      exchangesKnown: true,
    };
  } catch {
    return { lastAt: localAt, exchangesSince: 0, exchangesKnown: false };
  }
}

export function notePhotoStarted(userId: string): () => void {
  inflight.set(userId, (inflight.get(userId) || 0) + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (inflight.get(userId) || 1) - 1;
    if (left <= 0) inflight.delete(userId);
    else inflight.set(userId, left);
  };
}

/** In-isolate record of a sent photo, used when the ledger query fails. */
export function notePhotoSent(userId: string, now = Date.now()): void {
  const list = (recent.get(userId) || []).filter((t) => now - t < 86_400_000);
  list.push(now);
  recent.set(userId, list);
}

function localUsage(userId: string, now: number): PhotoUsage {
  const list = (recent.get(userId) || []).filter((t) => now - t < 86_400_000);
  return { hour: list.filter((t) => now - t < 3_600_000).length, day: list.length };
}

export async function photoUsage(userId: string, now = Date.now()): Promise<PhotoUsage> {
  const pending = inflight.get(userId) || 0;
  try {
    const { rows } = await getPool().query<{ hour: string | number; day: string | number }>(
      `SELECT count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS hour,
              count(*) AS day
         FROM chat_turns
        WHERE user_id = $1
          AND created_at > now() - interval '24 hours'
          AND metadata -> 'companion_photo' ->> 'status' = 'sent'`,
      [userId],
    );
    const row = rows[0] || { hour: 0, day: 0 };
    return { hour: Number(row.hour) + pending, day: Number(row.day) + pending };
  } catch {
    const local = localUsage(userId, now);
    return { hour: local.hour + pending, day: local.day + pending };
  }
}

export function checkPhotoLimit(usage: PhotoUsage, limits: { hourlyLimit: number; dailyLimit: number }): PhotoLimitResult {
  if (usage.day >= limits.dailyLimit) return { allowed: false, window: "day" };
  if (usage.hour >= limits.hourlyLimit) return { allowed: false, window: "hour" };
  return { allowed: true };
}

export function resetPhotoLimitsForTests(): void {
  inflight.clear();
  recent.clear();
  lastSpontaneous.clear();
}
