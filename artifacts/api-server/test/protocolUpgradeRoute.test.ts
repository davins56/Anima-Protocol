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

  function mockCursorLaunch() {
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
  }

  async function createPending(request = "Upgrade the interface to be darker.") {
    const res = await call("POST", "/protocol-upgrade", { request, surface: "test" });
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(202);
    return json;
  }

  it("records a pending weave and does not start a Cursor agent on the chat message alone", async () => {
    mockCursorLaunch();
    const json = await createPending();
    expect(json.status).toBe("awaiting_confirmation");
    expect(json.agent_id).toBeNull();
    expect(json.expires_at).toBeTruthy();
    expect(json.serenity_message).toMatch(/confirm/i);
    expect(cursorFetch).not.toHaveBeenCalled();
  });

  it("launches the Cursor cloud agent only after the steward confirms", async () => {
    const pending = await createPending();
    mockCursorLaunch();
    const res = await call("POST", `/protocol-upgrade/${pending.id}/confirm`, {});
    const json = await res.json();
    expect(res.status, JSON.stringify(json)).toBe(201);
    expect(json.agent_id).toBe("bc-upgrade");
    expect(json.agent_url).toContain("bc-upgrade");
    expect(json.confirmed_at).toBeTruthy();
    expect(json.serenity_message).toMatch(/weaving/i);
    expect(cursorFetch).toHaveBeenCalledTimes(1);
  });

  it("does not launch twice when confirm is repeated", async () => {
    const pending = await createPending();
    mockCursorLaunch();
    const first = await call("POST", `/protocol-upgrade/${pending.id}/confirm`, {});
    expect(first.status).toBe(201);
    const second = await call("POST", `/protocol-upgrade/${pending.id}/confirm`, {});
    expect(second.status).toBe(409);
    expect(cursorFetch).toHaveBeenCalledTimes(1);
  });

  it("refuses confirmation from a non-steward", async () => {
    const pending = await createPending();
    const res = await call(
      "POST",
      `/protocol-upgrade/${pending.id}/confirm`,
      {},
      { "x-test-user": "stranger" },
    );
    expect(res.status).toBe(403);
    expect(cursorFetch).not.toHaveBeenCalled();
  });

  it("cancels a pending weave so it can no longer be confirmed", async () => {
    const pending = await createPending();
    const cancelled = await call("POST", `/protocol-upgrade/${pending.id}/cancel`, {});
    expect(cancelled.status).toBe(200);
    expect((await cancelled.json()).status).toBe("cancelled");
    const confirm = await call("POST", `/protocol-upgrade/${pending.id}/confirm`, {});
    expect(confirm.status).toBe(409);
    expect(cursorFetch).not.toHaveBeenCalled();
  });

  it("refuses an expired confirmation", async () => {
    const pending = await createPending();
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(Date.now() + 16 * 60_000);
      const res = await call("POST", `/protocol-upgrade/${pending.id}/confirm`, {});
      expect(res.status).toBe(410);
      expect((await res.json()).code).toBe("confirmation_expired");
    } finally {
      vi.useRealTimers();
    }
    expect(cursorFetch).not.toHaveBeenCalled();
  });

  it("does not treat an allowlisted email as the steward", async () => {
    const res = await call(
      "POST",
      "/protocol-upgrade",
      { request: "Upgrade the interface to be darker." },
      { "x-test-user": "someone-else", "x-test-email": "davins56@gmail.com" },
    );
    expect(res.status).toBe(403);
  });

  it("reports steward configuration and the confirmation requirement", async () => {
    const res = await call("GET", "/protocol-upgrade/capability");
    const json = await res.json();
    expect(json.isSteward).toBe(true);
    expect(json.stewardConfigured).toBe(true);
    expect(json.requiresConfirmation).toBe(true);
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
