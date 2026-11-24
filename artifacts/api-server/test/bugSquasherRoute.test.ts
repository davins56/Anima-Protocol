import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: null,
  }),
}));

const role = vi.fn(async ({ userId }: { userId: string }) => ({
  role: userId === "admin_1" ? "admin" : "user",
  isSteward: false,
}));
vi.mock("../src/lib/accountRole", () => ({ resolveAccountRole: (input: { userId: string }) => role(input) }));

const query = vi.fn();
vi.mock("@workspace/db", () => ({ getPool: () => ({ query }) }));

import bugSquasherRouter from "../src/routes/bugSquasher";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit";
import { MAX_NEW_BUGS_PER_DAY } from "../src/lib/bugSquasher/store";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/bug-squasher", bugSquasherRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  query.mockReset();
  role.mockClear();
  resetRateLimitStateForTests();
});

function call(path: string, init: { method?: string; user?: string | null; body?: unknown } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.user) headers["x-test-user"] = init.user;
  return fetch(`${baseUrl}/bug-squasher${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const upsertRow = (over: Record<string, unknown> = {}) => ({
  rows: [
    {
      id: "11111111-1111-1111-1111-111111111111",
      fingerprint: "a_0123456789abcdef0123456789abcdef",
      status: "new",
      count: 1,
      reopen_count: 0,
      inserted: true,
      reopened: false,
      ...over,
    },
  ],
});

describe("POST /bug-squasher/reports", () => {
  it("rejects signed-out callers without touching the database", async () => {
    const res = await call("/reports", { method: "POST", body: { kind: "manual", description: "broken" } });
    expect(res.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
  });

  it("validates the body", async () => {
    const res = await call("/reports", { method: "POST", user: "user_1", body: { kind: "evil" } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_input");
    expect(query).not.toHaveBeenCalled();
  });

  it("stores a scrubbed report under the session user, never the body's user id", async () => {
    query.mockResolvedValueOnce({ rows: [{ exists: false, recent: 0 }] }).mockResolvedValueOnce(upsertRow());
    const res = await call("/reports", {
      method: "POST",
      user: "user_1",
      body: {
        kind: "window_error",
        message: "TypeError: x is undefined Bearer abc.def.ghi",
        user_id: "user_attacker",
        context: { breadcrumbs: [], password: "hunter2" },
      },
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.report.status).toBe("new");
    const [sql, params] = query.mock.calls[1];
    expect(sql).toMatch(/INSERT INTO bug_reports/);
    expect(sql).toMatch(/ON CONFLICT \(user_id, fingerprint\) DO UPDATE/);
    expect(params[0]).toBe("user_1");
    expect(params[1]).toMatch(/^a_[0-9a-f]{32}$/);
    expect(params[4]).not.toContain("abc.def.ghi");
    expect(params[10]).not.toContain("hunter2");
  });

  it("answers 200 for a repeat and reports a reopen", async () => {
    query
      .mockResolvedValueOnce({ rows: [{ exists: true, recent: 5 }] })
      .mockResolvedValueOnce(upsertRow({ inserted: false, count: 4, reopened: true, reopen_count: 1 }));
    const res = await call("/reports", { method: "POST", user: "user_1", body: { kind: "react_crash", message: "boom" } });
    expect(res.status).toBe(200);
    expect((await res.json()).report).toMatchObject({ count: 4, reopened: true });
  });

  it("caps distinct new bugs per user per day", async () => {
    query.mockResolvedValueOnce({ rows: [{ exists: false, recent: MAX_NEW_BUGS_PER_DAY }] });
    const res = await call("/reports", { method: "POST", user: "user_1", body: { kind: "window_error", message: "x" } });
    expect(res.status).toBe(429);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("says the schema is missing (503) before the migration is applied", async () => {
    query.mockRejectedValueOnce(Object.assign(new Error("relation does not exist"), { code: "42P01" }));
    const res = await call("/reports", { method: "POST", user: "user_1", body: { kind: "window_error", message: "x" } });
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("bug_squasher_schema_missing");
  });

  it("rate-limits a flood from one user", async () => {
    query.mockImplementation(async (sql: string) =>
      /SELECT EXISTS/.test(sql) ? { rows: [{ exists: true, recent: 1 }] } : upsertRow({ inserted: false }),
    );
    const statuses: number[] = [];
    for (let i = 0; i < 32; i += 1) {
      const res = await call("/reports", { method: "POST", user: "user_flood", body: { kind: "window_error", message: "x" } });
      statuses.push(res.status);
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThan(0);
  });
});

describe("GET /bug-squasher/reports/mine", () => {
  it("lists only the caller's rows", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "r1", kind: "manual", status: "new", title: "t", count: "2" }] });
    const res = await call("/reports/mine", { user: "user_1" });
    expect(res.status).toBe(200);
    expect((await res.json()).reports[0].count).toBe(2);
    expect(query.mock.calls[0][1][0]).toBe("user_1");
    expect(query.mock.calls[0][0]).toMatch(/WHERE user_id = \$1/);
  });
});

describe("admin triage routes", () => {
  it("refuse non-admins", async () => {
    const res = await call("/admin/groups", { user: "user_1" });
    expect(res.status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("refuse signed-out callers", async () => {
    const res = await call("/admin/groups");
    expect(res.status).toBe(401);
  });

  it("list groups for an admin with a status filter", async () => {
    query.mockResolvedValueOnce({
      rows: [{ fingerprint: "a_x", status: "new", total_count: "7", user_count: 2, reopen_count: 1 }],
    });
    const res = await call("/admin/groups?status=new&q=chat", { user: "admin_1" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.groups[0].total_count).toBe(7);
    expect(query.mock.calls[0][1]).toEqual(["new", "chat", 100]);
  });

  it("ignore an unknown status filter", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await call("/admin/groups?status=bogus", { user: "admin_1" });
    expect(query.mock.calls[0][1][0]).toBeNull();
  });

  it("load one group and 404 an unknown one", async () => {
    query.mockResolvedValueOnce({ rows: [{ id: "r1", count: 3, reopen_count: 0 }] });
    const ok = await call("/admin/groups/a_0123456789abcdef", { user: "admin_1" });
    expect(ok.status).toBe(200);
    query.mockResolvedValueOnce({ rows: [] });
    const missing = await call("/admin/groups/a_0123456789abcdef", { user: "admin_1" });
    expect(missing.status).toBe(404);
    const bad = await call("/admin/groups/NOT%20VALID!", { user: "admin_1" });
    expect(bad.status).toBe(400);
  });

  it("mark a group fixed for every row with that fingerprint", async () => {
    query.mockResolvedValueOnce({ rows: [{ n: 3 }] });
    const res = await call("/admin/groups/a_0123456789abcdef", {
      method: "PATCH",
      user: "admin_1",
      body: { status: "fixed", note: "PR #781" },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "fixed", updated: 3 });
    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/UPDATE bug_reports SET/);
    expect(sql).toMatch(/WHERE fingerprint = \$1/);
    expect(params).toEqual(["a_0123456789abcdef", "fixed", "PR #781", "admin_1"]);
  });

  it("reject an invalid status", async () => {
    const res = await call("/admin/groups/a_0123456789abcdef", { method: "PATCH", user: "admin_1", body: { status: "done" } });
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("return a screenshot by id", async () => {
    query.mockResolvedValueOnce({ rows: [{ screenshot: "data:image/jpeg;base64,AAAA" }] });
    const res = await call("/admin/reports/11111111-1111-1111-1111-111111111111/screenshot", { user: "admin_1" });
    expect(res.status).toBe(200);
    expect((await res.json()).screenshot).toMatch(/^data:image\/jpeg/);
  });
});
