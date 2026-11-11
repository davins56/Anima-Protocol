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
}
