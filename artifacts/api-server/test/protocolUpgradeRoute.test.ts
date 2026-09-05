import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: req.headers["x-test-email"]
      ? { email: req.headers["x-test-email"] }
      : null,
  }),
  createClerkClient: () => ({
    users: {
      getUser: async () => ({
        emailAddresses: [],
        primaryEmailAddressId: null,
      }),
    },
  }),
}));

const originalKey = process.env.CURSOR_API_KEY;
const originalAdmins = process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS;
const nativeFetch = globalThis.fetch.bind(globalThis);

const cursorFetch = vi.fn();
vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes("api.cursor.com")) {
    return cursorFetch(input, init);
  }
  return nativeFetch(input, init);
});

import protocolUpgradeRouter from "../src/routes/protocolUpgrade";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = "steward-user";
  process.env.CURSOR_API_KEY = "crsr_test";
  const app: Express = express();
  app.use(express.json());
  app.use("/protocol-upgrade", protocolUpgradeRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(() => {
  cursorFetch.mockReset();
});

afterAll(async () => {
  if (originalKey === undefined) delete process.env.CURSOR_API_KEY;
  else process.env.CURSOR_API_KEY = originalKey;
  if (originalAdmins === undefined) delete process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS;
  else process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = originalAdmins;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "steward-user",
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("protocol upgrade routes", () => {
  it("classifies a steward interface request", async () => {
    const res = await call("POST", "/protocol-upgrade/classify", {
      request: "Upgrade the interface with a quieter mobile header.",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.shouldLaunch).toBe(true);
    expect(json.scope).toBe("interface");
  });

  it("refuses non-stewards", async () => {
    const res = await call(
      "POST",
      "/protocol-upgrade",
      { request: "Upgrade the interface to be darker." },
      { "x-test-user": "stranger" },
    );
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("not_steward");
    expect(json.serenity_message).toMatch(/steward/i);
  });

  it("launches a Cursor cloud agent for the steward", async () => {
    cursorFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          agent: {
            id: "bc-upgrade",
            url: "https://cursor.com/agents/bc-upgrade",
            latestRunId: "run-upgrade",
          },
          run: { id: "run-upgrade", status: "CREATING" },
        }),
        { status: 200 },
      ),
    );

    const res = await call("POST", "/protocol-upgrade", {
      request: "Upgrade the interface to be darker.",
      surface: "test",
    });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(201);
    expect(json.agent_id).toBe("bc-upgrade");
    expect(json.agent_url).toContain("bc-upgrade");
    expect(json.serenity_message).toMatch(/weaving/i);
    expect(cursorFetch).toHaveBeenCalled();
  });

  it("rejects ordinary chat as not an upgrade", async () => {
    const res = await call("POST", "/protocol-upgrade", {
      request: "I missed you tonight.",
    });
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.code).toBe("not_an_upgrade");
  });
});
