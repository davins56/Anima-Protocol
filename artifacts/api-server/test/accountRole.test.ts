import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: req.headers["x-test-email"] ? { email: req.headers["x-test-email"] } : null,
  }),
  createClerkClient: () => ({
    users: { getUser: async () => ({ emailAddresses: [], primaryEmailAddressId: null }) },
  }),
}));

import accountRouter from "../src/routes/account";
import { resolveAccountRole } from "../src/lib/accountRole";

const SAVED = {
  stewards: process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS,
  stewardEmails: process.env.PROTOCOL_UPGRADE_ADMIN_EMAILS,
  admins: process.env.ANIMA_ADMIN_USER_IDS,
  adminEmails: process.env.ANIMA_ADMIN_EMAILS,
  clerk: process.env.CLERK_SECRET_KEY,
};

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use("/account", accountRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

beforeEach(() => {
  process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = "user_steward";
  process.env.PROTOCOL_UPGRADE_ADMIN_EMAILS = "steward@example.com";
  process.env.ANIMA_ADMIN_USER_IDS = "user_admin";
  process.env.ANIMA_ADMIN_EMAILS = "ops@example.com";
  delete process.env.CLERK_SECRET_KEY;
});

afterAll(async () => {
  for (const [key, name] of [
    ["stewards", "PROTOCOL_UPGRADE_ADMIN_USER_IDS"],
    ["stewardEmails", "PROTOCOL_UPGRADE_ADMIN_EMAILS"],
    ["admins", "ANIMA_ADMIN_USER_IDS"],
    ["adminEmails", "ANIMA_ADMIN_EMAILS"],
    ["clerk", "CLERK_SECRET_KEY"],
  ] as const) {
    const value = SAVED[key];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function role(headers: Record<string, string>) {
  const res = await fetch(`${baseUrl}/account/role`, { headers });
  return { status: res.status, body: await res.json() };
}

describe("GET /account/role", () => {
  it("requires a signed-in user", async () => {
    expect((await role({})).status).toBe(401);
  });

  it("marks the steward (by Clerk user id) as admin + steward", async () => {
    const { status, body } = await role({ "x-test-user": "user_steward" });
    expect(status).toBe(200);
    expect(body).toEqual({ role: "admin", isSteward: true });
  });

  it("marks a server-side admin user id as admin but not steward", async () => {
    const { body } = await role({ "x-test-user": "user_admin" });
    expect(body).toEqual({ role: "admin", isSteward: false });
  });

  it("matches ANIMA_ADMIN_EMAILS against the caller's email on the server", async () => {
    const { body } = await role({ "x-test-user": "user_ops", "x-test-email": "OPS@example.com" });
    expect(body).toEqual({ role: "admin", isSteward: false });
  });

  it("returns a plain user for everyone else", async () => {
    const { body } = await role({ "x-test-user": "user_rando", "x-test-email": "rando@example.com" });
    expect(body).toEqual({ role: "user", isSteward: false });
  });
});

describe("resolveAccountRole", () => {
  it("ignores an empty admin allowlist", async () => {
    delete process.env.ANIMA_ADMIN_USER_IDS;
    delete process.env.ANIMA_ADMIN_EMAILS;
    await expect(resolveAccountRole({ userId: "user_admin" })).resolves.toEqual({
      role: "user",
      isSteward: false,
    });
  });
});
