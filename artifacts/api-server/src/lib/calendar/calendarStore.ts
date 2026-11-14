/**
 * Persistence for calendar awareness.
 *
 * - calendar_connections (supabase/migrations/20261114020000_calendar_connections.sql):
 *   encrypted refresh token per user+provider. Server-only.
 * - user_profiles.data.calendar_busy: the latest busy blocks only (start/end,
 *   no titles), one statement per write so other profile keys are untouched.
 *
 * Until the migration is applied, every read treats a missing table (42P01)
 * as "no connections" so Day Rhythm and "Forget my rhythm data" keep working.
 */
import { getPool } from "@workspace/db";
import { CALENDAR_BUSY_PROFILE_KEY, readStoredCalendarBusy, type CalendarBusySnapshot } from "../kernel/senses";
import type { CalendarProvider } from "./providers";

export type CalendarConnectionRow = {
  provider: CalendarProvider;
  refreshTokenEnc: string;
  scopes: string;
  status: "active" | "reauth_required";
  lastSyncedAt: string | null;
  lastError: string | null;
  createdAt: string;
};

export function isMissingRelation(err: unknown): boolean {
  return Boolean(err && typeof err === "object" && (err as { code?: string }).code === "42P01");
}

function iso(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

export async function listConnections(userId: string): Promise<CalendarConnectionRow[]> {
  try {
    const { rows } = await getPool().query<Record<string, unknown>>(
      `SELECT provider, refresh_token_enc, scopes, status, last_synced_at, last_error, created_at
         FROM calendar_connections WHERE user_id = $1 ORDER BY provider`,
      [userId],
    );
    return rows.map((r) => ({
      provider: r.provider as CalendarProvider,
      refreshTokenEnc: String(r.refresh_token_enc),
      scopes: String(r.scopes),
      status: r.status === "reauth_required" ? "reauth_required" : "active",
      lastSyncedAt: iso(r.last_synced_at),
      lastError: r.last_error == null ? null : String(r.last_error),
      createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    }));
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}

export async function upsertConnection(
  userId: string,
  provider: CalendarProvider,
  refreshTokenEnc: string,
  scopes: string,
): Promise<void> {
  await getPool().query(
    `INSERT INTO calendar_connections (user_id, provider, refresh_token_enc, scopes, status, last_error, updated_at)
     VALUES ($1, $2, $3, $4, 'active', NULL, now())
     ON CONFLICT (user_id, provider) DO UPDATE
       SET refresh_token_enc = EXCLUDED.refresh_token_enc, scopes = EXCLUDED.scopes,
           status = 'active', last_error = NULL, updated_at = now()`,
    [userId, provider, refreshTokenEnc, scopes.slice(0, 500)],
  );
}

export async function rotateRefreshToken(userId: string, provider: CalendarProvider, refreshTokenEnc: string): Promise<void> {
  await getPool().query(
    `UPDATE calendar_connections SET refresh_token_enc = $3, updated_at = now() WHERE user_id = $1 AND provider = $2`,
    [userId, provider, refreshTokenEnc],
  );
}

export async function markSynced(
  userId: string,
  provider: CalendarProvider,
  result: { ok: true } | { ok: false; error: string; reauth: boolean },
): Promise<void> {
  if (result.ok) {
    await getPool().query(
      `UPDATE calendar_connections SET last_synced_at = now(), last_error = NULL, status = 'active', updated_at = now()
        WHERE user_id = $1 AND provider = $2`,
      [userId, provider],
    );
    return;
  }
  await getPool().query(
    `UPDATE calendar_connections
        SET last_error = $3, status = CASE WHEN $4 THEN 'reauth_required' ELSE status END, updated_at = now()
      WHERE user_id = $1 AND provider = $2`,
    [userId, provider, result.error.slice(0, 200), result.reauth],
  );
}

/** Deletes and returns the deleted rows (so the caller can revoke them). */
export async function deleteConnections(userId: string, provider?: CalendarProvider): Promise<CalendarConnectionRow[]> {
  try {
    const { rows } = await getPool().query<Record<string, unknown>>(
      provider
        ? `DELETE FROM calendar_connections WHERE user_id = $1 AND provider = $2 RETURNING provider, refresh_token_enc, scopes, status, created_at`
        : `DELETE FROM calendar_connections WHERE user_id = $1 RETURNING provider, refresh_token_enc, scopes, status, created_at`,
      provider ? [userId, provider] : [userId],
    );
    return rows.map((r) => ({
      provider: r.provider as CalendarProvider,
      refreshTokenEnc: String(r.refresh_token_enc),
      scopes: String(r.scopes),
      status: r.status === "reauth_required" ? "reauth_required" : "active",
      lastSyncedAt: null,
      lastError: null,
      createdAt: iso(r.created_at) ?? new Date(0).toISOString(),
    }));
  } catch (err) {
    if (isMissingRelation(err)) return [];
    throw err;
  }
}

export async function saveCalendarBusy(userId: string, snap: CalendarBusySnapshot): Promise<void> {
  await getPool().query(
    `INSERT INTO user_profiles (user_id, data, updated_at)
     VALUES ($1, jsonb_build_object('${CALENDAR_BUSY_PROFILE_KEY}', $2::jsonb), now())
     ON CONFLICT (user_id) DO UPDATE
       SET data = COALESCE(user_profiles.data, '{}'::jsonb) || jsonb_build_object('${CALENDAR_BUSY_PROFILE_KEY}', $2::jsonb),
           updated_at = now()`,
    [userId, JSON.stringify(snap)],
  );
}

export async function loadCalendarBusy(userId: string, now = Date.now()): Promise<CalendarBusySnapshot | null> {
  const { rows } = await getPool().query<{ busy: unknown }>(
    `SELECT data -> '${CALENDAR_BUSY_PROFILE_KEY}' AS busy FROM user_profiles WHERE user_id = $1`,
    [userId],
  );
  return readStoredCalendarBusy(rows[0]?.busy ?? null, now);
}

export async function clearCalendarBusy(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE user_profiles SET data = data - '${CALENDAR_BUSY_PROFILE_KEY}', updated_at = now() WHERE user_id = $1`,
    [userId],
  );
}
