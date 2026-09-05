import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Regression tests for the Cloudflare Workers "Cannot perform I/O on behalf of
 * a different request" failure.
 *
 * Workers bind every I/O object to the request context that created it. A
 * Postgres client cached at module scope therefore cannot be reused — or
 * closed — by a later request. In production this surfaced as /api/healthz/db
 * returning 503 "Database unavailable" with that signal on roughly half of
 * requests, and 20s ETIMEOUT hangs on the rest.
 */

const savedDriver = process.env.ANIMA_DB_DRIVER;
const savedDatabaseUrl = process.env.DATABASE_URL;

/** Make isCloudflareWorkerRuntime() report the Workers runtime. */
function pretendWorkerRuntime(enabled: boolean) {
  if (enabled) {
    vi.stubGlobal("navigator", { userAgent: "Cloudflare-Workers" });
  } else {
    vi.unstubAllGlobals();
  }
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  if (savedDriver === undefined) delete process.env.ANIMA_DB_DRIVER;
  else process.env.ANIMA_DB_DRIVER = savedDriver;
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("cross-request I/O error detection", () => {
  const CROSS_REQUEST =
    "Cannot perform I/O on behalf of a different request. I/O objects " +
    "(such as streams, request/response bodies, and others) created in the " +
    "context of one request handler cannot be accessed from a different " +
    "request's handler.";

  it("recognises the Workers cross-request violation", async () => {
    const { isCrossRequestIoError } = await import("../src/client");
    expect(isCrossRequestIoError(new Error(CROSS_REQUEST))).toBe(true);
    expect(isCrossRequestIoError(new Error("read ECONNRESET"))).toBe(false);
  });

  it("treats it as transient so withTransientDbRetry can recover", async () => {
    const { isTransientDbError } = await import("../src/client");
    // Before the fix this was false, so the poisoned client stayed cached and
    // every later request on the same isolate failed.
    expect(isTransientDbError(new Error(CROSS_REQUEST))).toBe(true);
  });

  it("finds it through a drizzle 'Failed query' cause chain", async () => {
    const { isTransientDbError } = await import("../src/client");
    const wrapped = new Error("Failed query: select 1", {
      cause: new Error(CROSS_REQUEST),
    });
    expect(isTransientDbError(wrapped)).toBe(true);
  });

  it("retries and succeeds after one cross-request failure", async () => {
    const { withTransientDbRetry } = await import("../src/client");
    let calls = 0;
    const result = await withTransientDbRetry(async () => {
      calls += 1;
      if (calls === 1) throw new Error(CROSS_REQUEST);
      return "recovered";
    });
    expect(result).toBe("recovered");
    expect(calls).toBe(2);
  });
});

describe("per-request client lifetime on Workers", () => {
  beforeEach(() => {
    process.env.ANIMA_DB_DRIVER = "node-pg";
    process.env.DATABASE_URL =
      "postgresql://u:p@127.0.0.1:5432/db?sslmode=disable";
  });

  it("reuses one client for repeated calls within the same request", async () => {
    pretendWorkerRuntime(true);
    const { beginDbRequest, getPool, resetPool } = await import(
      "../src/client"
    );
    resetPool();

    beginDbRequest();
    const first = getPool();
    const second = getPool();
    expect(second).toBe(first);
    resetPool();
  });

  it("does NOT carry a client across request scopes on Workers", async () => {
    pretendWorkerRuntime(true);
    const { beginDbRequest, getPool, resetPool, dbRequestEpochForTests } =
      await import("../src/client");
    resetPool();

    beginDbRequest();
    const fromRequestOne = getPool();
    const epochOne = dbRequestEpochForTests().pool;

    beginDbRequest();
    const fromRequestTwo = getPool();
    const epochTwo = dbRequestEpochForTests().pool;

    // A different client, tagged to the new request scope. This is what keeps
    // the socket from crossing a request boundary.
    expect(fromRequestTwo).not.toBe(fromRequestOne);
    expect(epochTwo).not.toBe(epochOne);
    resetPool();
  });

  it("isolates client instances across concurrent overlapping requests via AsyncLocalStorage", async () => {
    pretendWorkerRuntime(true);
    const { runWithDbRequestScope, getPool, resetPool } = await import(
      "../src/client"
    );
    resetPool();

    let clientReq1A: unknown;
    let clientReq1B: unknown;
    let clientReq2A: unknown;
    let clientReq2B: unknown;

    await Promise.all([
      runWithDbRequestScope(async () => {
        clientReq1A = getPool();
        await new Promise((r) => setTimeout(r, 10));
        clientReq1B = getPool();
      }),
      runWithDbRequestScope(async () => {
        await new Promise((r) => setTimeout(r, 5));
        clientReq2A = getPool();
        await new Promise((r) => setTimeout(r, 10));
        clientReq2B = getPool();
      }),
    ]);

    expect(clientReq1A).toBe(clientReq1B);
    expect(clientReq2A).toBe(clientReq2B);
    expect(clientReq1A).not.toBe(clientReq2A);
    resetPool();
  });

  it("keeps reusing the cached client off-Workers (Node / Vercel / tests)", async () => {
    pretendWorkerRuntime(false);
    const { beginDbRequest, getPool, resetPool } = await import(
      "../src/client"
    );
    resetPool();

    beginDbRequest();
    const first = getPool();
    beginDbRequest();
    const second = getPool();

    // On a long-lived Node process the pool is intentionally shared, so a new
    // request scope must not throw the connection away.
    expect(second).toBe(first);
    resetPool();
  });

  it("routes db (drizzle) through the same request-scope check", async () => {
    pretendWorkerRuntime(true);
    const clientSource = await import("node:fs").then((fs) =>
      fs.readFileSync(
        new URL("../src/client.ts", import.meta.url),
        "utf8",
      ),
    );
    // getDb() must not short-circuit on a cached dbInstance — that bypassed
    // the epoch check and handed back a previous request's socket.
    expect(clientSource).not.toMatch(/if \(dbInstance\) return dbInstance;/);
  });
});

describe("teardown safety on Workers", () => {
  beforeEach(() => {
    process.env.ANIMA_DB_DRIVER = "node-pg";
    process.env.DATABASE_URL =
      "postgresql://u:p@127.0.0.1:5432/db?sslmode=disable";
  });

  it("never calls end() on a client owned by another request", async () => {
    pretendWorkerRuntime(true);
    const { beginDbRequest, getPool, resetPool } = await import(
      "../src/client"
    );
    resetPool();

    beginDbRequest();
    const pool = getPool() as unknown as {
      end: () => Promise<void>;
      removeAllListeners: (event: string) => unknown;
    };
    const end = vi.spyOn(pool, "end");

    // Second request scope: the cached client must be dropped, not closed.
    // Closing it is the call that actually threw the cross-request error.
    beginDbRequest();
    getPool();

    expect(end).not.toHaveBeenCalled();
    resetPool();
  });

  it("still closes the pool off-Workers so Node does not leak connections", async () => {
    pretendWorkerRuntime(false);
    const { getPool, resetPool } = await import("../src/client");
    resetPool();

    const pool = getPool() as unknown as { end: () => Promise<void> };
    const end = vi.spyOn(pool, "end").mockResolvedValue(undefined);

    resetPool();
    expect(end).toHaveBeenCalled();
  });

  it("does not let a teardown failure escape into the query path", async () => {
    pretendWorkerRuntime(false);
    const { getPool, resetPool } = await import("../src/client");
    resetPool();

    const pool = getPool() as unknown as { end: () => Promise<void> };
    vi.spyOn(pool, "end").mockImplementation(() => {
      throw new Error("Cannot perform I/O on behalf of a different request");
    });

    // Before the fix this threw straight out of getPool() into the caller.
    expect(() => resetPool()).not.toThrow();
  });
});
