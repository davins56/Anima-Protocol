import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
  createClerkClient: () => ({ users: { getUser: async () => ({ emailAddresses: [] }) } }),
}));
vi.mock("@workspace/db", () => ({ getPool: () => { throw new Error("no db in unit tests"); } }));

import { adultGate } from "../src/lib/safety/adultGate";
import {
  ageOn,
  isAdultAttested,
  parseDob,
  selfDeclarationLocked,
  selfDeclaredDobProvider,
  userIsAdultAttested,
  invalidateAdultCache,
  type AttestationRow,
} from "../src/lib/safety/ageGate";
import { profileWriteNeedsStewardCheck, requireSteward, sanitizeProfileWrite } from "../src/lib/safety/stewardGate";
import { createSafetyRouter } from "../src/routes/safety";
import { resolveChatModePolicy } from "../src/lib/chatModeRegistry";

const NOW = new Date("2026-10-22T12:00:00Z");

describe("age check", () => {
  it("parses strict, real dates", () => {
    expect(parseDob("2000-02-29")).toEqual({ year: 2000, month: 2, day: 29 });
    expect(() => parseDob("2001-02-29")).toThrow(/doesn't exist/);
    expect(() => parseDob("22/10/2000")).toThrow(/YYYY-MM-DD/);
    expect(() => parseDob(undefined)).toThrow();
  });
  it("counts completed years, birthday-exact", () => {
    expect(ageOn(parseDob("2008-10-22"), NOW)).toBe(18);
    expect(ageOn(parseDob("2008-10-23"), NOW)).toBe(17);
    expect(() => ageOn(parseDob("2030-01-01"), NOW)).toThrow(/future/);
  });
  it("self-declared provider attests 18+ and rejects under-18", async () => {
    await expect(selfDeclaredDobProvider.verify({ userId: "u", dob: "2008-10-22" }, NOW)).resolves.toMatchObject({ status: "attested", ageYears: 18, birthYear: 2008 });
    await expect(selfDeclaredDobProvider.verify({ userId: "u", dob: "2008-10-23" }, NOW)).resolves.toMatchObject({ status: "rejected", ageYears: 17 });
  });
  it("only an attested latest row counts; a self-declared rejection locks self-declaration", () => {
    expect(isAdultAttested({ status: "attested", age_years: 30 })).toBe(true);
    expect(isAdultAttested({ status: "revoked", age_years: 30 })).toBe(false);
    expect(isAdultAttested(null)).toBe(false);
    expect(selfDeclarationLocked([{ status: "attested", method: "self_declared_dob" }])).toBe(false);
    expect(selfDeclarationLocked([{ status: "rejected", method: "self_declared_dob" }])).toBe(true);
  });
  it("fails closed when the attestation store is unavailable", async () => {
    invalidateAdultCache();
    const broken = { query: async () => { throw new Error("db down"); } };
    await expect(userIsAdultAttested("u-down", broken as any)).resolves.toBe(false);
  });
});

describe("adult gate (server)", () => {
  const base = { therapy: false, crossover: false, ageAttested: true, settingEnabled: true, requested: true };
  it("allows only attested, non-therapy, non-crossover requests", () => {
    expect(adultGate(base)).toEqual({ adult: true, reason: "allowed" });
    expect(adultGate({ ...base, ageAttested: false })).toEqual({ adult: false, reason: "not_attested" });
    expect(adultGate({ ...base, settingEnabled: false, requested: false })).toEqual({ adult: false, reason: "not_requested" });
  });
  it("is always off in crossover scenes, even when attested and requested (P1-11)", () => {
    const d = adultGate({ ...base, crossover: true });
    expect(d).toEqual({ adult: false, reason: "crossover" });
    expect(resolveChatModePolicy({ isCrossover: true, adult: d.adult }).adultAllowed).toBe(false);
  });
  it("is always off in therapy", () => {
    expect(adultGate({ ...base, therapy: true }).adult).toBe(false);
  });
  it("a client adult_mode flag alone can't enable adult", () => {
    expect(adultGate({ ...base, settingEnabled: false, ageAttested: false }).adult).toBe(false);
  });
});

describe("profile write sanitising (P1-6)", () => {
  const write = {
    name: "x",
    settings: {
      adult_content_enabled: true,
      echo_keys: { granted_full_library: true, owned_ids: ["a"] },
      energy_fragments: { granted_full_library: true },
      memory_crystals: { granted_all_types: true },
      inventory: { granted_full_catalog: true },
    },
  };
  it("strips steward grants and unattested adult mode for non-stewards", () => {
    const { data, stripped } = sanitizeProfileWrite(write, { isSteward: false, adultAttested: false });
    const s = data.settings as any;
    expect(s.echo_keys).toEqual({ granted_full_library: false, owned_ids: ["a"] });
    expect(s.energy_fragments.granted_full_library).toBe(false);
    expect(s.memory_crystals.granted_all_types).toBe(false);
    expect(s.inventory.granted_full_catalog).toBe(false);
    expect(s.adult_content_enabled).toBe(false);
    expect(stripped).toHaveLength(5);
    expect(data.name).toBe("x");
  });
  it("keeps them for an attested steward", () => {
    const { data, stripped } = sanitizeProfileWrite(write, { isSteward: true, adultAttested: true });
    expect(stripped).toEqual([]);
    expect(data).toEqual(write);
  });
  it("only asks for a steward lookup when a grant flag is set", () => {
    expect(profileWriteNeedsStewardCheck(write)).toBe(true);
    expect(profileWriteNeedsStewardCheck({ settings: { echo_keys: { granted_full_library: false } } })).toBe(false);
  });
});

describe("HTTP gates", () => {
  let server: Server;
  let base = "";
  const rows: Array<AttestationRow & { user_id: string }> = [];
  const deps = {
    steward: async ({ userId }: { userId: string }) => ({ allowed: userId === "steward" }),
    history: async (userId: string) => rows.filter((r) => r.user_id === userId).slice().reverse(),
    append: async (r: any) => {
      const row = { user_id: r.userId, status: r.status, method: r.method, provider: r.provider ?? null, birth_year: r.birthYear ?? null, age_years: r.ageYears ?? null, attested_at: new Date().toISOString() };
      rows.push(row);
      return row;
    },
    provider: () => selfDeclaredDobProvider,
  };

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/api/safety", createSafetyRouter(deps as any));
    app.get("/api/steward-only", requireSteward({ check: deps.steward }), (_req, res) => {
      res.json({ ok: true });
    });
    await new Promise<void>((r) => {
      server = app.listen(0, "127.0.0.1", () => r());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const post = (path: string, body: unknown, user = "adult") =>
    fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", "x-test-user": user }, body: JSON.stringify(body) });

  it("requires confirmation and a real DOB", async () => {
    expect((await post("/api/safety/age-attestation", { dob: "1990-01-01" })).status).toBe(400);
    expect((await post("/api/safety/age-attestation", { dob: "nope", confirm: true })).status).toBe(400);
    expect(rows).toHaveLength(0);
  });

  it("stores an attestation with a timestamp and no full DOB", async () => {
    const res = await post("/api/safety/age-attestation", { dob: "1990-05-17", confirm: true });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ status: "attested", adult_eligible: true });
    expect(body.attested_at).toBeTruthy();
    expect(JSON.stringify(rows)).not.toContain("05-17");
    const status = await (await fetch(`${base}/api/safety/status`, { headers: { "x-test-user": "adult" } })).json();
    expect(status).toMatchObject({ is_steward: false, adult_eligible: true, age: { status: "attested" } });
  });

  it("rejects under-18 and then locks self-declaration", async () => {
    const res = await post("/api/safety/age-attestation", { dob: "2012-01-01", confirm: true }, "kid");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("under_age");
    const retry = await post("/api/safety/age-attestation", { dob: "1990-01-01", confirm: true }, "kid");
    expect(retry.status).toBe(403);
    expect((await retry.json()).code).toBe("self_declaration_locked");
    expect(rows.filter((r) => r.user_id === "kid").map((r) => r.status)).toEqual(["rejected"]);
  });

  it("revokes by appending a row", async () => {
    const res = await post("/api/safety/age-attestation/revoke", {});
    expect((await res.json()).adult_eligible).toBe(false);
    expect(rows.filter((r) => r.user_id === "adult").map((r) => r.status)).toEqual(["attested", "revoked"]);
  });

  it("steward middleware: 401 signed out, 403 non-steward, 200 steward", async () => {
    expect((await fetch(`${base}/api/steward-only`)).status).toBe(401);
    const denied = await fetch(`${base}/api/steward-only`, { headers: { "x-test-user": "adult" } });
    expect(denied.status).toBe(403);
    expect((await denied.json()).code).toBe("not_steward");
    expect((await fetch(`${base}/api/steward-only`, { headers: { "x-test-user": "steward" } })).status).toBe(200);
  });
});
