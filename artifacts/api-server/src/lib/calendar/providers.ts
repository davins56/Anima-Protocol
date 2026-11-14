/**
 * Calendar providers for calendar awareness (Settings > Day Rhythm).
 *
 * Reads busy/free time only, never titles:
 * - Google: scope https://www.googleapis.com/auth/calendar.freebusy ("View
 *   your availability in your calendars"), POST /calendar/v3/freeBusy on the
 *   primary calendar. The response holds only busy {start, end} ranges.
 * - Microsoft: delegated Calendars.ReadBasic + offline_access. Graph has no
 *   narrower delegated calendar scope. getSchedule is not supported for
 *   personal Microsoft accounts and returns `subject` for your own calendar,
 *   so this uses GET /me/calendarView with $select=start,end,showAs,isCancelled:
 *   Graph never sends the subject, body, location or attendees back.
 *
 * All fetches run on the Cloudflare Worker. `fetchImpl` is injectable for tests.
 */
import { readRuntimeEnv } from "../cloudflareEnv";

export type CalendarProvider = "google" | "microsoft";
export const CALENDAR_PROVIDERS: readonly CalendarProvider[] = ["google", "microsoft"];

export const CALENDAR_ENV = {
  google: { clientId: "GOOGLE_CALENDAR_CLIENT_ID", clientSecret: "GOOGLE_CALENDAR_CLIENT_SECRET" },
  microsoft: { clientId: "MICROSOFT_CALENDAR_CLIENT_ID", clientSecret: "MICROSOFT_CALENDAR_CLIENT_SECRET" },
} as const;
/** Optional. Defaults to "common" (work, school and personal accounts). */
export const MICROSOFT_TENANT_ENV = "MICROSOFT_CALENDAR_TENANT";
/** Public origin used to build redirect URIs. Falls back to ANIMA_APP_ORIGIN. Never the Host header. */
export const CALENDAR_REDIRECT_ORIGIN_ENV = "ANIMA_CALENDAR_REDIRECT_ORIGIN";

export const GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";
export const MICROSOFT_CALENDAR_SCOPE = "https://graph.microsoft.com/Calendars.ReadBasic";
export const PROVIDER_SCOPES: Record<CalendarProvider, string[]> = {
  google: [GOOGLE_FREEBUSY_SCOPE],
  microsoft: ["offline_access", MICROSOFT_CALENDAR_SCOPE],
};

/** How far ahead busy blocks are read (matches the senses lookahead). */
export const BUSY_LOOKAHEAD_MS = 48 * 3_600_000;

export type ProviderConfig = {
  provider: CalendarProvider;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tenant: string;
};

export type EnvReader = (name: string) => string | undefined;

export function isCalendarProvider(v: unknown): v is CalendarProvider {
  return v === "google" || v === "microsoft";
}

/** https origin (or http://localhost for local dev), no path; null otherwise. */
export function calendarRedirectOrigin(read: EnvReader = readRuntimeEnv): string | null {
  const raw = String(read(CALENDAR_REDIRECT_ORIGIN_ENV) || read("ANIMA_APP_ORIGIN") || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    const local = u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1");
    if (u.protocol !== "https:" && !local) return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function redirectUriFor(provider: CalendarProvider, origin: string): string {
  return `${origin}/api/calendar/oauth/${provider}/callback`;
}

export function providerConfig(provider: CalendarProvider, read: EnvReader = readRuntimeEnv): ProviderConfig | null {
  const names = CALENDAR_ENV[provider];
  const clientId = String(read(names.clientId) || "").trim();
  const clientSecret = String(read(names.clientSecret) || "").trim();
  const origin = calendarRedirectOrigin(read);
  if (!clientId || !clientSecret || !origin) return null;
  const tenantRaw = String(read(MICROSOFT_TENANT_ENV) || "common").trim();
  const tenant = /^[A-Za-z0-9.-]{1,64}$/.test(tenantRaw) ? tenantRaw : "common";
  return { provider, clientId, clientSecret, redirectUri: redirectUriFor(provider, origin), tenant };
}

function msBase(cfg: ProviderConfig): string {
  return `https://login.microsoftonline.com/${encodeURIComponent(cfg.tenant)}/oauth2/v2.0`;
}

export function authorizeUrl(cfg: ProviderConfig, state: string, codeChallenge: string): string {
  if (cfg.provider === "google") {
    const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    u.search = new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      response_type: "code",
      scope: PROVIDER_SCOPES.google.join(" "),
      access_type: "offline",
      prompt: "consent",
      include_granted_scopes: "false",
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    }).toString();
    return u.toString();
  }
  const u = new URL(`${msBase(cfg)}/authorize`);
  u.search = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: PROVIDER_SCOPES.microsoft.join(" "),
    prompt: "select_account",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  }).toString();
  return u.toString();
}

export class CalendarProviderError extends Error {
  constructor(
    public readonly code: "reauth_required" | "provider_error" | "scope_missing" | "no_refresh_token",
    message: string,
  ) {
    super(message);
  }
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
};

async function postForm(fetchImpl: typeof fetch, url: string, form: Record<string, string>): Promise<{ status: number; body: TokenResponse }> {
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form).toString(),
  });
  let body: TokenResponse = {};
  try {
    body = (await res.json()) as TokenResponse;
  } catch {
    body = {};
  }
  return { status: res.status, body };
}

function tokenUrl(cfg: ProviderConfig): string {
  return cfg.provider === "google" ? "https://oauth2.googleapis.com/token" : `${msBase(cfg)}/token`;
}

/** Granted scopes must include the busy/free scope. */
function assertScope(cfg: ProviderConfig, scope: string | undefined): string {
  const granted = String(scope || "").split(/\s+/).filter(Boolean);
  const need = cfg.provider === "google" ? GOOGLE_FREEBUSY_SCOPE : "Calendars.ReadBasic";
  const ok = granted.some((s) => s === need || s.endsWith(`/${need}`));
  if (!ok) throw new CalendarProviderError("scope_missing", "Calendar permission was not granted");
  return granted.join(" ");
}

export async function exchangeCode(
  cfg: ProviderConfig,
  code: string,
  codeVerifier: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; refreshToken: string; scopes: string }> {
  const form: Record<string, string> = {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    code,
    code_verifier: codeVerifier,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  };
  if (cfg.provider === "microsoft") form.scope = PROVIDER_SCOPES.microsoft.join(" ");
  const { status, body } = await postForm(fetchImpl, tokenUrl(cfg), form);
  if (status < 200 || status >= 300 || !body.access_token) {
    throw new CalendarProviderError("provider_error", `Token exchange failed (${status})`);
  }
  const scopes = assertScope(cfg, body.scope);
  if (!body.refresh_token) throw new CalendarProviderError("no_refresh_token", "Provider sent no refresh token");
  return { accessToken: body.access_token, refreshToken: body.refresh_token, scopes };
}

/** New access token; Microsoft may rotate the refresh token (returned when it does). */
export async function refreshAccessToken(
  cfg: ProviderConfig,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ accessToken: string; rotatedRefreshToken: string | null }> {
  const form: Record<string, string> = {
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  };
  if (cfg.provider === "microsoft") form.scope = PROVIDER_SCOPES.microsoft.join(" ");
  const { status, body } = await postForm(fetchImpl, tokenUrl(cfg), form);
  if (body.error === "invalid_grant" || body.error === "interaction_required") {
    throw new CalendarProviderError("reauth_required", "Calendar sign-in expired or was revoked");
  }
  if (status < 200 || status >= 300 || !body.access_token) {
    throw new CalendarProviderError("provider_error", `Token refresh failed (${status})`);
  }
  const rotated = body.refresh_token && body.refresh_token !== refreshToken ? body.refresh_token : null;
  return { accessToken: body.access_token, rotatedRefreshToken: rotated };
}

/** Busy {startsAt, endsAt} blocks for [now, now + 48h). Never reads titles. */
export async function fetchBusyBlocks(
  provider: CalendarProvider,
  accessToken: string,
  now = Date.now(),
  fetchImpl: typeof fetch = fetch,
): Promise<Array<{ startsAt: string; endsAt: string }>> {
  const timeMin = new Date(now).toISOString();
  const timeMax = new Date(now + BUSY_LOOKAHEAD_MS).toISOString();
  if (provider === "google") {
    const res = await fetchImpl("https://www.googleapis.com/calendar/v3/freeBusy", {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ timeMin, timeMax, timeZone: "UTC", items: [{ id: "primary" }] }),
    });
    if (res.status === 401) throw new CalendarProviderError("reauth_required", "Google rejected the token");
    if (!res.ok) throw new CalendarProviderError("provider_error", `Google freeBusy failed (${res.status})`);
    const data = (await res.json()) as { calendars?: Record<string, { busy?: Array<{ start?: string; end?: string }> }> };
    const busy = data.calendars?.primary?.busy ?? [];
    return busy
      .filter((b) => typeof b?.start === "string" && typeof b?.end === "string")
      .map((b) => ({ startsAt: String(b.start), endsAt: String(b.end) }));
  }
  const u = new URL("https://graph.microsoft.com/v1.0/me/calendarView");
  u.search = new URLSearchParams({
    startDateTime: timeMin,
    endDateTime: timeMax,
    $select: "start,end,showAs,isCancelled",
    $top: "100",
  }).toString();
  const res = await fetchImpl(u.toString(), {
    method: "GET",
    headers: { Authorization: `Bearer ${accessToken}`, Prefer: 'outlook.timezone="UTC"', Accept: "application/json" },
  });
  if (res.status === 401) throw new CalendarProviderError("reauth_required", "Microsoft rejected the token");
  if (!res.ok) throw new CalendarProviderError("provider_error", `Microsoft calendarView failed (${res.status})`);
  const data = (await res.json()) as {
    value?: Array<{ start?: { dateTime?: string }; end?: { dateTime?: string }; showAs?: string; isCancelled?: boolean }>;
  };
  const out: Array<{ startsAt: string; endsAt: string }> = [];
  for (const ev of data.value ?? []) {
    if (ev?.isCancelled) continue;
    const showAs = String(ev?.showAs || "busy").toLowerCase();
    if (showAs !== "busy" && showAs !== "oof" && showAs !== "tentative") continue;
    const s = graphUtc(ev?.start?.dateTime);
    const e = graphUtc(ev?.end?.dateTime);
    if (s && e) out.push({ startsAt: s, endsAt: e });
  }
  return out;
}

/** Graph returns "2026-11-14T15:00:00.0000000" in the Prefer'd zone (UTC). */
function graphUtc(v: unknown): string | null {
  if (typeof v !== "string" || !v) return null;
  const withZone = /[zZ]|[+-]\d\d:\d\d$/.test(v) ? v : `${v}Z`;
  const t = Date.parse(withZone);
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

/**
 * Revoke at the provider where an endpoint exists. Google: yes (oauth2
 * /revoke). Microsoft identity platform has no endpoint to revoke one app's
 * delegated refresh token; the stored token is deleted and the user can remove
 * the app at https://account.live.com/consent/Manage (personal) or
 * https://myapplications.microsoft.com (work or school).
 */
export async function revokeToken(
  provider: CalendarProvider,
  refreshToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<"revoked" | "not_supported" | "failed"> {
  if (provider !== "google") return "not_supported";
  try {
    const res = await fetchImpl("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    });
    // 400 invalid_token: already revoked or expired; nothing left to revoke.
    return res.ok || res.status === 400 ? "revoked" : "failed";
  } catch {
    return "failed";
  }
}
