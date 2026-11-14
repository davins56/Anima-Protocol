/**
 * Calendar awareness against the disposable per-run Postgres schema
 * (test/setup-db.ts): the migration's table, encrypted token storage, sync
 * into user_profiles.data.calendar_busy, disconnect, and "Forget my rhythm
 * data" (DELETE /api/senses) clearing calendar connections too.
 * Provider HTTP is a fake fetch; nothing leaves the box.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import { getPool } from "@workspace/db";
import calendarRouter, { CALENDAR_STATE_COOKIE } from "../src/routes/calendar";
import sensesRouter from "../src/routes/senses";
import { listConnections, upsertConnection } from "../src/lib/calendar/calendarStore";
import {
  disconnectCalendar,
  maybeRefreshCalendarBusy,
  openOAuthState,
  syncCalendarBusy,
} from "../src/lib/calendar/calendarSync";
import { calendarKeyBytes, encryptSecret } from "../src/lib/calendar/tokenCrypto";
import { GOOGLE_FREEBUSY_SCOPE } from "../src/lib/calendar/providers";

const PREFIX = `cal_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userA = `${PREFIX}a`;
const userB = `${PREFIX}b`;
const KEY_B64 = Buffer.alloc(32, 9).toString("base64");
const KEY = calendarKeyBytes(KEY_B64)!;
const ENV: Record<string, string> = {
  ANIMA_KERNEL_SENSES: "1",
  ANIMA_CALENDAR_TOKEN_KEY: KEY_B64,
  ANIMA_APP_ORIGIN: "https://anima-protocol.com",
  GOOGLE_CALENDAR_CLIENT_ID: "g-id",
  GOOGLE_CALENDAR_CLIENT_SECRET: "g-secret",
  MICROSOFT_CALENDAR_CLIENT_ID: "m-id",
  MICROSOFT_CALENDAR_CLIENT_SECRET: "m-secret",
};
const read = (n: string) => ENV[n];
const saved: Record<string, string | undefined> = {};

let server: Server;
let baseUrl = "";

const migrationSql = readFileSync(
  new URL("../../../supabase/migrations/20261114020000_calendar_connections.sql", import.meta.url),
  "utf8",
);

function call(path: string, user: string | null, init: { method?: string; cookie?: string } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    redirect: "manual",
    headers: {
      ...(user ? { "x-test-user": user } : {}),
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
  });
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

/** Fake Google: token refresh + freeBusy + revoke. Records every URL. */
function fakeGoogle(busy: Array<{ start: string; end: string }>) {
  const calls: string[] = [];
  const impl = vi.fn(async (url: string) => {
    calls.push(url);
    if (url === "https://oauth2.googleapis.com/token") return jsonResponse(200, { access_token: "access-1" });
    if (url === "https://www.googleapis.com/calendar/v3/freeBusy") return jsonResponse(200, { calendars: { primary: { busy } } });
    if (url === "https://oauth2.googleapis.com/revoke") return jsonResponse(200, {});
    return jsonResponse(404, {});
  });
  return { impl: impl as unknown as typeof fetch, calls };
}

async function profileData(user: string): Promise<Record<string, unknown>> {
  const { rows } = await getPool().query<{ data: Record<string, unknown> }>(`SELECT data FROM user_profiles WHERE user_id = $1`, [user]);
  return rows[0]?.data ?? {};
}

beforeAll(async () => {
  for (const k of Object.keys(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = ENV[k];
  }
  const app = express();
  app.use(express.json());
  app.use("/api/calendar", calendarRouter);
  app.use("/api/senses", sensesRouter);
  server = app.listen(0);
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  for (const k of Object.keys(ENV)) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await getPool().query(`DELETE FROM user_profiles WHERE user_id LIKE $1`, [`${PREFIX}%`]);
});

describe("before the migration is applied", () => {
  it("treats a missing calendar_connections table as no connections", async () => {
    expect(await listConnections(userA)).toEqual([]);
    const status = await call("/api/calendar", userA);
    expect(status.status).toBe(200);
    expect(await status.json()).toMatchObject({ enabled: true, connections: [], busy: null });
    // Forget still works without the table.
    const forget = await call("/api/senses", userA, { method: "DELETE" });
    expect(forget.status).toBe(200);
  });
});

describe("with the calendar_connections migration", () => {
  beforeAll(async () => {
    // The test pool's search_path is the disposable schema, so drop "public."
    // to create the table there instead of in public.
    await getPool().query(migrationSql.replace(/public\./g, ""));
  });

  it("refuses unauthenticated status and connect", async () => {
    expect((await call("/api/calendar", null)).status).toBe(401);
    expect((await call("/api/calendar/connect/google", null, { method: "POST" })).status).toBe(401);
  });

  it("starts Google sign-in with a sealed state bound to a browser cookie", async () => {
    const res = await call("/api/calendar/connect/google", userA, { method: "POST" });
    expect(res.status).toBe(200);
    const { url } = (await res.json()) as { url: string };
    const u = new URL(url);
    expect(u.searchParams.get("scope")).toBe(GOOGLE_FREEBUSY_SCOPE);
    expect(u.searchParams.get("redirect_uri")).toBe("https://anima-protocol.com/api/calendar/oauth/google/callback");
    const state = await openOAuthState(u.searchParams.get("state")!, KEY);
    expect(state).toMatchObject({ userId: userA, provider: "google" });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${CALENDAR_STATE_COOKIE}=${encodeURIComponent(state!.nonce)}`);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).toMatch(/Path=\/api\/calendar\/oauth/);

    // Callback without the matching browser cookie is refused (no token exchange).
    const noCookie = await call(`/api/calendar/oauth/google/callback?code=c&state=${encodeURIComponent(u.searchParams.get("state")!)}`, null);
    expect(noCookie.status).toBe(302);
    expect(noCookie.headers.get("location")).toBe("https://anima-protocol.com/settings?section=interface&calendar=invalid_state&provider=google");
    const wrongProvider = await call(
      `/api/calendar/oauth/microsoft/callback?code=c&state=${encodeURIComponent(u.searchParams.get("state")!)}`,
      null,
      { cookie: `${CALENDAR_STATE_COOKIE}=${encodeURIComponent(state!.nonce)}` },
    );
    expect(wrongProvider.headers.get("location")).toContain("calendar=invalid_state");
    const denied = await call(`/api/calendar/oauth/google/callback?error=access_denied`, null);
    expect(denied.headers.get("location")).toContain("calendar=denied");
    expect(await listConnections(userA)).toEqual([]);
  });

  it("stores only ciphertext, syncs busy blocks into the snapshot, and the tick percept sees them", async () => {
    const now = Date.now();
    const sealed = await encryptSecret("1//google-refresh", `refresh:${userA}:google`, KEY);
    await upsertConnection(userA, "google", sealed, GOOGLE_FREEBUSY_SCOPE);
    const { rows } = await getPool().query(`SELECT * FROM calendar_connections WHERE user_id = $1`, [userA]);
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows[0])).not.toContain("google-refresh");
    // B cannot decrypt A's token even if the row were copied.
    await getPool().query(
      `INSERT INTO calendar_connections (user_id, provider, refresh_token_enc, scopes) VALUES ($1, 'google', $2, $3)`,
      [userB, sealed, GOOGLE_FREEBUSY_SCOPE],
    );

    const g = fakeGoogle([
      { start: new Date(now - 5 * 60_000).toISOString(), end: new Date(now + 40 * 60_000).toISOString() },
      { start: new Date(now + 3 * 3_600_000).toISOString(), end: new Date(now + 4 * 3_600_000).toISOString() },
    ]);
    const result = await syncCalendarBusy(userA, { fetchImpl: g.impl, read, now });
    expect(result).toMatchObject({ synced: true, providers: ["google"], busyBlocks: 2, errors: [] });
    expect(g.calls).toEqual(["https://oauth2.googleapis.com/token", "https://www.googleapis.com/calendar/v3/freeBusy"]);
    const data = await profileData(userA);
    expect(data.calendar_busy).toMatchObject({ providers: ["google"] });
    expect(JSON.stringify(data.calendar_busy)).not.toMatch(/title|summary|subject/);

    const status = await (await call("/api/senses", userA)).json();
    expect(status).toMatchObject({ enabled: true, present: false, busyNow: true, calendarSync: { busyBlocks: 2 } });

    // The agency tick reuses a fresh set without refetching.
    const again = fakeGoogle([]);
    const fresh = await maybeRefreshCalendarBusy(userA, data.calendar_busy, { fetchImpl: again.impl, read, now: now + 60_000 });
    expect(fresh?.busy).toHaveLength(2);
    expect(again.calls).toEqual([]);

    const bSync = await syncCalendarBusy(userB, { fetchImpl: fakeGoogle([]).impl, read, now });
    expect(bSync).toMatchObject({ synced: false, errors: [{ provider: "google", code: "reauth_required" }] });
    expect((await listConnections(userB))[0]).toMatchObject({ status: "reauth_required", lastError: "reauth_required" });
  });

  it("lists connections without tokens", async () => {
    const body = await (await call("/api/calendar", userA)).json();
    expect(body.connections).toEqual([
      expect.objectContaining({ provider: "google", status: "active", lastError: null }),
    ]);
    expect(JSON.stringify(body)).not.toMatch(/refresh|v1\./);
  });

  it("disconnect revokes at Google, deletes the token, and drops the busy set", async () => {
    const g = fakeGoogle([]);
    const out = await disconnectCalendar(userA, "google", { fetchImpl: g.impl, read });
    expect(out.removed).toEqual([{ provider: "google", revoke: "revoked" }]);
    expect(g.calls).toEqual(["https://oauth2.googleapis.com/revoke"]);
    expect(await listConnections(userA)).toEqual([]);
    expect((await profileData(userA)).calendar_busy).toBeUndefined();
  });

  it("'Forget my rhythm data' (DELETE /api/senses) removes calendar connections and busy blocks", async () => {
    const now = Date.now();
    await upsertConnection(userA, "microsoft", await encryptSecret("ms-refresh", `refresh:${userA}:microsoft`, KEY), "offline_access Calendars.ReadBasic");
    await getPool().query(
      `INSERT INTO user_profiles (user_id, data) VALUES ($1, $2::jsonb)
       ON CONFLICT (user_id) DO UPDATE SET data = user_profiles.data || EXCLUDED.data`,
      [userA, JSON.stringify({ calendar_busy: { receivedAt: new Date(now).toISOString(), providers: ["microsoft"], busy: [] }, senses: { receivedAt: new Date(now).toISOString() }, settings: { keep: true } })],
    );
    const res = await call("/api/senses", userA, { method: "DELETE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, calendarDisconnected: ["microsoft"] });
    expect(await listConnections(userA)).toEqual([]);
    const data = await profileData(userA);
    expect(data.calendar_busy).toBeUndefined();
    expect(data.senses).toBeUndefined();
    expect(data.settings).toEqual({ keep: true });
  });

  it("DELETE /api/calendar/:provider requires auth and a known provider", async () => {
    expect((await call("/api/calendar/google", null, { method: "DELETE" })).status).toBe(401);
    expect((await call("/api/calendar/yahoo", userA, { method: "DELETE" })).status).toBe(404);
    expect((await call("/api/calendar/google", userA, { method: "DELETE" })).status).toBe(200);
  });
});
