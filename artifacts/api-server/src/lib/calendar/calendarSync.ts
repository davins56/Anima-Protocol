/**
 * Calendar awareness orchestration: OAuth state, connect, sync, disconnect,
 * forget. Busy blocks feed the rhythm snapshot (user_profiles.data.calendar_busy)
 * that the agency tick reads, so companions hold off while the steward is busy.
 */
import { buildCalendarBusySnapshot, readStoredCalendarBusy, type CalendarBusySnapshot } from "../kernel/senses";
import { isKernelFeatureEnabled } from "../kernelFeatures";
import {
  clearCalendarBusy,
  deleteConnections,
  listConnections,
  markSynced,
  rotateRefreshToken,
  saveCalendarBusy,
  upsertConnection,
} from "./calendarStore";
import {
  CalendarProviderError,
  exchangeCode,
  fetchBusyBlocks,
  isCalendarProvider,
  providerConfig,
  refreshAccessToken,
  revokeToken,
  type CalendarProvider,
  type EnvReader,
} from "./providers";
import { calendarKeyBytes, decryptSecret, encryptSecret, randomToken } from "./tokenCrypto";
import { readRuntimeEnv } from "../cloudflareEnv";

/** OAuth state lifetime. */
export const OAUTH_STATE_TTL_MS = 10 * 60_000;
/** Background refresh (agency tick) only when the stored set is older than this. */
export const CALENDAR_REFRESH_AFTER_MS = 30 * 60_000;
/** A manual sync within this window returns the stored set instead of refetching. */
export const CALENDAR_MIN_SYNC_GAP_MS = 5 * 60_000;

const refreshAad = (userId: string, provider: CalendarProvider) => `refresh:${userId}:${provider}`;
const STATE_AAD = "calendar-oauth-state";

export type OAuthState = { userId: string; provider: CalendarProvider; verifier: string; nonce: string; exp: number };

/** Calendar awareness is usable: senses switch on, token key set, and this provider's OAuth app configured. */
export function calendarAvailability(read: EnvReader = readRuntimeEnv) {
  const senses = isKernelFeatureEnabled("senses");
  const key = calendarKeyBytes(read("ANIMA_CALENDAR_TOKEN_KEY")) != null;
  return {
    enabled: senses,
    keyConfigured: key,
    providers: {
      google: key && providerConfig("google", read) != null,
      microsoft: key && providerConfig("microsoft", read) != null,
    },
  };
}

export async function sealOAuthState(state: OAuthState, key: Uint8Array): Promise<string> {
  return encryptSecret(
    JSON.stringify({ u: state.userId, p: state.provider, v: state.verifier, n: state.nonce, e: state.exp }),
    STATE_AAD,
    key,
  );
}

export async function openOAuthState(sealed: string, key: Uint8Array, now = Date.now()): Promise<OAuthState | null> {
  const plain = await decryptSecret(sealed, STATE_AAD, key);
  if (!plain) return null;
  try {
    const o = JSON.parse(plain) as Record<string, unknown>;
    if (typeof o.u !== "string" || !o.u || !isCalendarProvider(o.p)) return null;
    if (typeof o.v !== "string" || typeof o.n !== "string" || typeof o.e !== "number") return null;
    if (o.e < now) return null;
    return { userId: o.u, provider: o.p, verifier: o.v, nonce: o.n, exp: o.e };
  } catch {
    return null;
  }
}

export function newOAuthState(userId: string, provider: CalendarProvider, now = Date.now()): OAuthState {
  return { userId, provider, verifier: randomToken(48), nonce: randomToken(18), exp: now + OAUTH_STATE_TTL_MS };
}

/** Exchange the code, store the encrypted refresh token, then fetch busy blocks once. */
export async function completeConnection(
  state: OAuthState,
  code: string,
  opts: { fetchImpl?: typeof fetch; now?: number; read?: EnvReader } = {},
): Promise<CalendarSyncResult> {
  const read = opts.read ?? readRuntimeEnv;
  const key = calendarKeyBytes(read("ANIMA_CALENDAR_TOKEN_KEY"));
  const cfg = providerConfig(state.provider, read);
  if (!key || !cfg) throw new CalendarProviderError("provider_error", "Calendar sign-in is not configured");
  const tokens = await exchangeCode(cfg, code, state.verifier, opts.fetchImpl);
  const sealed = await encryptSecret(tokens.refreshToken, refreshAad(state.userId, state.provider), key);
  await upsertConnection(state.userId, state.provider, sealed, tokens.scopes);
  return syncCalendarBusy(state.userId, { ...opts, force: true });
}

export type CalendarSyncResult = {
  synced: boolean;
  providers: CalendarProvider[];
  busyBlocks: number;
  errors: Array<{ provider: CalendarProvider; code: string }>;
  snapshot: CalendarBusySnapshot | null;
};

/**
 * Refresh each active connection's access token, read busy blocks for the
 * next 48 hours, and overwrite user_profiles.data.calendar_busy with the
 * merged set (latest only). If every provider fails, the previous set is
 * left alone and still expires 6 hours after it was taken.
 */
export async function syncCalendarBusy(
  userId: string,
  opts: { fetchImpl?: typeof fetch; now?: number; read?: EnvReader; force?: boolean; previous?: CalendarBusySnapshot | null } = {},
): Promise<CalendarSyncResult> {
  const now = opts.now ?? Date.now();
  const read = opts.read ?? readRuntimeEnv;
  const key = calendarKeyBytes(read("ANIMA_CALENDAR_TOKEN_KEY"));
  const empty: CalendarSyncResult = { synced: false, providers: [], busyBlocks: 0, errors: [], snapshot: opts.previous ?? null };
  if (!key) return empty;
  const connections = (await listConnections(userId)).filter((c) => c.status === "active");
  if (connections.length === 0) return empty;

  const blocks: Array<{ startsAt: string; endsAt: string }> = [];
  const ok: CalendarProvider[] = [];
  const errors: CalendarSyncResult["errors"] = [];
  for (const conn of connections) {
    const cfg = providerConfig(conn.provider, read);
    if (!cfg) {
      errors.push({ provider: conn.provider, code: "not_configured" });
      continue;
    }
    try {
      const refresh = await decryptSecret(conn.refreshTokenEnc, refreshAad(userId, conn.provider), key);
      if (!refresh) throw new CalendarProviderError("reauth_required", "Stored token could not be decrypted");
      const { accessToken, rotatedRefreshToken } = await refreshAccessToken(cfg, refresh, opts.fetchImpl);
      if (rotatedRefreshToken) {
        await rotateRefreshToken(userId, conn.provider, await encryptSecret(rotatedRefreshToken, refreshAad(userId, conn.provider), key));
      }
      blocks.push(...(await fetchBusyBlocks(conn.provider, accessToken, now, opts.fetchImpl)));
      ok.push(conn.provider);
      await markSynced(userId, conn.provider, { ok: true });
    } catch (err) {
      const code = err instanceof CalendarProviderError ? err.code : "provider_error";
      errors.push({ provider: conn.provider, code });
      await markSynced(userId, conn.provider, { ok: false, error: code, reauth: code === "reauth_required" }).catch(() => {});
    }
  }
  if (ok.length === 0) return { ...empty, errors };
  const snapshot = buildCalendarBusySnapshot(ok, blocks, now);
  await saveCalendarBusy(userId, snapshot);
  return { synced: true, providers: ok, busyBlocks: snapshot.busy.length, errors, snapshot };
}

/**
 * Agency tick hook: refresh when the stored set is missing or older than
 * 30 minutes. Never throws; returns the freshest set it has.
 */
export async function maybeRefreshCalendarBusy(
  userId: string,
  storedRaw: unknown,
  opts: { fetchImpl?: typeof fetch; now?: number; read?: EnvReader } = {},
): Promise<CalendarBusySnapshot | null> {
  const now = opts.now ?? Date.now();
  const stored = readStoredCalendarBusy(storedRaw, now);
  try {
    if (!calendarAvailability(opts.read).keyConfigured) return stored;
    if (stored && now - Date.parse(stored.receivedAt) < CALENDAR_REFRESH_AFTER_MS) return stored;
    const result = await syncCalendarBusy(userId, { ...opts, previous: stored });
    return result.snapshot ?? stored;
  } catch {
    return stored;
  }
}

/** Revoke where possible, then delete the stored token(s). With no provider: all of them, plus the busy set. */
export async function disconnectCalendar(
  userId: string,
  provider?: CalendarProvider,
  opts: { fetchImpl?: typeof fetch; read?: EnvReader } = {},
): Promise<{ removed: Array<{ provider: CalendarProvider; revoke: "revoked" | "not_supported" | "failed" | "skipped" }> }> {
  const read = opts.read ?? readRuntimeEnv;
  const key = calendarKeyBytes(read("ANIMA_CALENDAR_TOKEN_KEY"));
  const rows = await deleteConnections(userId, provider);
  const removed: Array<{ provider: CalendarProvider; revoke: "revoked" | "not_supported" | "failed" | "skipped" }> = [];
  for (const row of rows) {
    const refresh = key ? await decryptSecret(row.refreshTokenEnc, refreshAad(userId, row.provider), key) : null;
    const revoke = refresh ? await revokeToken(row.provider, refresh, opts.fetchImpl) : "skipped";
    removed.push({ provider: row.provider, revoke });
  }
  // Busy blocks are merged across providers, so drop the set; the next sync
  // rebuilds it from whatever connection is left.
  await clearCalendarBusy(userId);
  return { removed };
}
