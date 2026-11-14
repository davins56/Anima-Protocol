/**
 * Calendar awareness, pure half: token crypto, OAuth state, provider request
 * shapes (busy/free only, never titles), busy-block merging and the percept
 * the agency tick reads. No network: every provider call uses a fake fetch.
 */
import { describe, expect, it, vi } from "vitest";
import {
  calendarKeyBytes,
  decryptSecret,
  encryptSecret,
  pkceChallenge,
} from "../src/lib/calendar/tokenCrypto";
import {
  authorizeUrl,
  calendarRedirectOrigin,
  exchangeCode,
  fetchBusyBlocks,
  GOOGLE_FREEBUSY_SCOPE,
  providerConfig,
  refreshAccessToken,
  revokeToken,
  type EnvReader,
} from "../src/lib/calendar/providers";
import { newOAuthState, openOAuthState, sealOAuthState, OAUTH_STATE_TTL_MS } from "../src/lib/calendar/calendarSync";
import {
  buildCalendarBusySnapshot,
  normalizeBusyBlocks,
  normalizeSensesSnapshot,
  readStoredCalendarBusy,
  SENSES_MAX_AGE_MS,
  sensesPercept,
  summarizeSenses,
} from "../src/lib/kernel/senses";

const NOW = Date.parse("2026-11-14T15:00:00Z");
const at = (minutes: number) => new Date(NOW + minutes * 60_000).toISOString();
const KEY_B64 = Buffer.alloc(32, 7).toString("base64");
const KEY = calendarKeyBytes(KEY_B64)!;

const ENV: Record<string, string> = {
  ANIMA_CALENDAR_TOKEN_KEY: KEY_B64,
  ANIMA_APP_ORIGIN: "https://anima-protocol.com",
  GOOGLE_CALENDAR_CLIENT_ID: "g-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "g-secret",
  MICROSOFT_CALENDAR_CLIENT_ID: "m-id",
  MICROSOFT_CALENDAR_CLIENT_SECRET: "m-secret",
};
const read: EnvReader = (name) => ENV[name];

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("calendar token crypto", () => {
  it("round-trips and binds ciphertext to its AAD", async () => {
    const sealed = await encryptSecret("1//refresh-token", "refresh:u1:google", KEY);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(sealed).not.toContain("refresh-token");
    expect(await decryptSecret(sealed, "refresh:u1:google", KEY)).toBe("1//refresh-token");
    expect(await decryptSecret(sealed, "refresh:u2:google", KEY)).toBeNull();
    expect(await decryptSecret(sealed, "refresh:u1:google", calendarKeyBytes(Buffer.alloc(32, 8).toString("base64"))!)).toBeNull();
    const tampered = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
    expect(await decryptSecret(tampered, "refresh:u1:google", KEY)).toBeNull();
  });

  it("requires a 32-byte key", () => {
    expect(calendarKeyBytes(undefined)).toBeNull();
    expect(calendarKeyBytes("")).toBeNull();
    expect(calendarKeyBytes(Buffer.alloc(16).toString("base64"))).toBeNull();
    expect(calendarKeyBytes(Buffer.alloc(32, 1).toString("base64url"))).not.toBeNull();
  });
});

describe("calendar OAuth state", () => {
  it("seals user, provider and PKCE verifier; rejects expiry and tampering", async () => {
    const state = newOAuthState("user_1", "google", NOW);
    const sealed = await sealOAuthState(state, KEY);
    expect(sealed).not.toContain("user_1");
    expect(await openOAuthState(sealed, KEY, NOW)).toEqual(state);
    expect(await openOAuthState(sealed, KEY, NOW + OAUTH_STATE_TTL_MS + 1)).toBeNull();
    expect(await openOAuthState(sealed + "x", KEY, NOW)).toBeNull();
    // A sealed refresh token cannot be replayed as a state (different AAD).
    expect(await openOAuthState(await encryptSecret("{}", "refresh:user_1:google", KEY), KEY, NOW)).toBeNull();
  });
});

describe("calendar providers", () => {
  it("builds redirect URIs from the configured origin only", () => {
    expect(calendarRedirectOrigin(read)).toBe("https://anima-protocol.com");
    expect(calendarRedirectOrigin((n) => (n === "ANIMA_APP_ORIGIN" ? "http://evil.example" : undefined))).toBeNull();
    expect(calendarRedirectOrigin((n) => (n === "ANIMA_CALENDAR_REDIRECT_ORIGIN" ? "http://localhost:8787/x" : undefined))).toBe(
      "http://localhost:8787",
    );
    expect(providerConfig("google", read)?.redirectUri).toBe("https://anima-protocol.com/api/calendar/oauth/google/callback");
    expect(providerConfig("microsoft", read)?.redirectUri).toBe("https://anima-protocol.com/api/calendar/oauth/microsoft/callback");
    expect(providerConfig("google", (n) => (n === "GOOGLE_CALENDAR_CLIENT_ID" ? "x" : undefined))).toBeNull();
  });

  it("asks Google for calendar.freebusy only, offline, with PKCE", async () => {
    const url = new URL(authorizeUrl(providerConfig("google", read)!, "STATE", await pkceChallenge("v")));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe(GOOGLE_FREEBUSY_SCOPE);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("STATE");
  });

  it("asks Microsoft for Calendars.ReadBasic + offline_access on /common", async () => {
    const url = new URL(authorizeUrl(providerConfig("microsoft", read)!, "STATE", await pkceChallenge("v")));
    expect(url.origin + url.pathname).toBe("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("scope")).toBe("offline_access https://graph.microsoft.com/Calendars.ReadBasic");
    expect(url.searchParams.get("scope")).not.toMatch(/Calendars\.Read(\s|$)|ReadWrite|User\.Read|Mail/);
  });

  it("rejects a code exchange without the busy/free scope or a refresh token", async () => {
    const cfg = providerConfig("google", read)!;
    const wrongScope = vi.fn(async () => jsonResponse(200, { access_token: "a", refresh_token: "r", scope: "openid" }));
    await expect(exchangeCode(cfg, "c", "v", wrongScope as unknown as typeof fetch)).rejects.toMatchObject({ code: "scope_missing" });
    const noRefresh = vi.fn(async () => jsonResponse(200, { access_token: "a", scope: GOOGLE_FREEBUSY_SCOPE }));
    await expect(exchangeCode(cfg, "c", "v", noRefresh as unknown as typeof fetch)).rejects.toMatchObject({ code: "no_refresh_token" });
    const good = vi.fn(async () => jsonResponse(200, { access_token: "a", refresh_token: "r", scope: GOOGLE_FREEBUSY_SCOPE }));
    await expect(exchangeCode(cfg, "c", "v", good as unknown as typeof fetch)).resolves.toMatchObject({ refreshToken: "r" });
    const body = new URLSearchParams(String((good.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.get("code_verifier")).toBe("v");
    expect(body.get("redirect_uri")).toBe(cfg.redirectUri);
  });

  it("maps invalid_grant to reauth_required and returns a rotated Microsoft refresh token", async () => {
    const cfg = providerConfig("microsoft", read)!;
    const revoked = vi.fn(async () => jsonResponse(400, { error: "invalid_grant" }));
    await expect(refreshAccessToken(cfg, "r", revoked as unknown as typeof fetch)).rejects.toMatchObject({ code: "reauth_required" });
    const rotated = vi.fn(async () => jsonResponse(200, { access_token: "a2", refresh_token: "r2" }));
    expect(await refreshAccessToken(cfg, "r", rotated as unknown as typeof fetch)).toEqual({ accessToken: "a2", rotatedRefreshToken: "r2" });
  });

  it("reads Google busy ranges from freeBusy on the primary calendar", async () => {
    const f = vi.fn(async () =>
      jsonResponse(200, { calendars: { primary: { busy: [{ start: at(-10), end: at(50) }, { start: at(120), end: at(180) }] } } }),
    );
    const blocks = await fetchBusyBlocks("google", "tok", NOW, f as unknown as typeof fetch);
    expect(blocks).toEqual([
      { startsAt: at(-10), endsAt: at(50) },
      { startsAt: at(120), endsAt: at(180) },
    ]);
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    expect(JSON.parse(String(init.body)).items).toEqual([{ id: "primary" }]);
  });

  it("never asks Microsoft Graph for subjects and keeps only busy/oof/tentative", async () => {
    const f = vi.fn(async () =>
      jsonResponse(200, {
        value: [
          { start: { dateTime: "2026-11-14T14:50:00.0000000" }, end: { dateTime: "2026-11-14T15:50:00.0000000" }, showAs: "busy" },
          { start: { dateTime: "2026-11-14T17:00:00.0000000" }, end: { dateTime: "2026-11-14T18:00:00.0000000" }, showAs: "free" },
          { start: { dateTime: "2026-11-14T19:00:00.0000000" }, end: { dateTime: "2026-11-14T20:00:00.0000000" }, showAs: "tentative" },
          { start: { dateTime: "2026-11-14T21:00:00.0000000" }, end: { dateTime: "2026-11-14T22:00:00.0000000" }, showAs: "busy", isCancelled: true },
          { subject: "Secret meeting", start: { dateTime: "2026-11-14T23:00:00.0000000" }, end: { dateTime: "2026-11-14T23:30:00.0000000" }, showAs: "oof" },
        ],
      }),
    );
    const blocks = await fetchBusyBlocks("microsoft", "tok", NOW, f as unknown as typeof fetch);
    expect(blocks).toEqual([
      { startsAt: "2026-11-14T14:50:00.000Z", endsAt: "2026-11-14T15:50:00.000Z" },
      { startsAt: "2026-11-14T19:00:00.000Z", endsAt: "2026-11-14T20:00:00.000Z" },
      { startsAt: "2026-11-14T23:00:00.000Z", endsAt: "2026-11-14T23:30:00.000Z" },
    ]);
    expect(JSON.stringify(blocks)).not.toContain("Secret");
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    const u = new URL(url);
    expect(u.pathname).toBe("/v1.0/me/calendarView");
    expect(u.searchParams.get("$select")).toBe("start,end,showAs,isCancelled");
    expect(u.searchParams.get("$select")).not.toMatch(/subject|body|location|attendees/);
    expect((init.headers as Record<string, string>).Prefer).toBe('outlook.timezone="UTC"');
  });

  it("revokes at Google and reports Microsoft as not supported", async () => {
    const f = vi.fn(async () => jsonResponse(200, {}));
    expect(await revokeToken("google", "r", f as unknown as typeof fetch)).toBe("revoked");
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe("https://oauth2.googleapis.com/revoke");
    const m = vi.fn();
    expect(await revokeToken("microsoft", "r", m as unknown as typeof fetch)).toBe("not_supported");
    expect(m).not.toHaveBeenCalled();
  });
});

describe("calendar busy blocks in the rhythm snapshot", () => {
  it("keeps start/end only, merges overlaps, drops noise", () => {
    const blocks = normalizeBusyBlocks(
      [
        { startsAt: at(0), endsAt: at(30), title: "drop me" },
        { start: at(20), end: at(60) },
        { startsAt: at(-120), endsAt: at(-60) },
        { startsAt: at(60 * 72), endsAt: at(60 * 73) },
        { startsAt: at(0), endsAt: at(60 * 24) },
        { startsAt: at(90), endsAt: at(120) },
      ],
      NOW,
    );
    expect(blocks).toEqual([
      { startsAt: at(0), endsAt: at(60) },
      { startsAt: at(90), endsAt: at(120) },
    ]);
    expect(JSON.stringify(blocks)).not.toContain("title");
  });

  it("expires after 6 hours like the device snapshot", () => {
    const snap = buildCalendarBusySnapshot(["google"], [{ startsAt: at(10), endsAt: at(40) }], NOW);
    expect(readStoredCalendarBusy(snap, NOW + SENSES_MAX_AGE_MS - 1)).not.toBeNull();
    expect(readStoredCalendarBusy(snap, NOW + SENSES_MAX_AGE_MS + 1)).toBeNull();
  });

  it("makes the agency percept busy during a calendar block, even with no device snapshot", () => {
    const busy = buildCalendarBusySnapshot(["microsoft"], [{ startsAt: at(-5), endsAt: at(25) }], NOW);
    expect(sensesPercept(null, NOW, busy)).toEqual({ busyNow: true, busyForMinutes: 25 });
    expect(sensesPercept(null, NOW + 30 * 60_000, busy)).toEqual({ busyNow: false, busyForMinutes: null });
    const device = normalizeSensesSnapshot({ timezone: "America/New_York", calendar: [] }, NOW);
    expect(sensesPercept(device, NOW, busy)).toEqual({ busyNow: true, busyForMinutes: 25 });
    expect(sensesPercept(null, NOW, null)).toBeNull();
  });

  it("summarizes counts without titles", () => {
    const busy = buildCalendarBusySnapshot(["google"], [{ startsAt: at(30), endsAt: at(60) }], NOW);
    const device = normalizeSensesSnapshot({ calendar: [{ title: "Dentist", startsAt: at(120), endsAt: at(150) }] }, NOW);
    const summary = summarizeSenses(device, NOW, busy);
    expect(summary).toMatchObject({ present: true, calendarBlocks: 2, busyNow: false, nextBlockInMinutes: 30 });
    expect(JSON.stringify(summary)).not.toContain("Dentist");
    expect(summarizeSenses(null, NOW, busy)).toMatchObject({ present: false, busyNow: false, nextBlockInMinutes: 30 });
  });
});
