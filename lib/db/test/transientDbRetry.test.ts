import { afterEach, describe, expect, it } from "vitest";
import {
  getPool,
  isTransientDbError,
  resetPool,
  withTransientDbRetry,
} from "../src/client";

afterEach(() => {
  resetPool();
});

describe("isTransientDbError", () => {
  it("treats ECONNRESET and connection-terminated as transient", () => {
    expect(
      isTransientDbError(
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
      ),
    ).toBe(true);
    expect(
      isTransientDbError(new Error("Connection terminated unexpectedly")),
    ).toBe(true);
    expect(
      isTransientDbError(new Error("Network connection lost")),
    ).toBe(true);
    expect(
      isTransientDbError(
        Object.assign(new Error("write CONNECT_TIMEOUT"), {
          code: "CONNECT_TIMEOUT",
        }),
      ),
    ).toBe(true);
    expect(
      isTransientDbError(
        new Error("Cannot use a pool after calling end on the pool"),
      ),
    ).toBe(true);
  });

  it("unwraps ECONNRESET from a drizzle Failed query cause", () => {
    const cause = Object.assign(new Error("read ECONNRESET"), {
      code: "ECONNRESET",
    });
    const wrapped = new Error("Failed query: insert into user_entities");
    (wrapped as Error & { cause?: unknown }).cause = cause;
    expect(isTransientDbError(wrapped)).toBe(true);
  });

  it("does not retry auth or missing-schema failures", () => {
    expect(
      isTransientDbError(
        Object.assign(new Error('password authentication failed for user "x"'), {
          code: "28P01",
        }),
      ),
    ).toBe(false);
    expect(
      isTransientDbError(
        Object.assign(new Error('relation "user_entities" does not exist'), {
          code: "42P01",
        }),
      ),
    ).toBe(false);
    expect(isTransientDbError(new Error("Publishable key not valid."))).toBe(
      false,
    );
  });
});

describe("withTransientDbRetry", () => {
  it("retries after the pool was ended during recycle", async () => {
    let calls = 0;
    const result = await withTransientDbRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("Cannot use a pool after calling end on the pool");
      }
      return "reopened";
    });
    expect(result).toBe("reopened");
    expect(calls).toBe(2);
  });

  it("retries a reset once and then succeeds", async () => {
    let calls = 0;
    const result = await withTransientDbRetry(async () => {
      calls += 1;
      if (calls === 1) {
        throw Object.assign(new Error("read ECONNRESET"), {
          code: "ECONNRESET",
        });
      }
      return "ok";
    });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("does not retry a schema error", async () => {
    let calls = 0;
    await expect(
      withTransientDbRetry(async () => {
        calls += 1;
        throw Object.assign(new Error('relation "chat_sessions" does not exist'), {
          code: "42P01",
        });
      }),
    ).rejects.toMatchObject({ code: "42P01" });
    expect(calls).toBe(1);
  });

  it("gives up after the configured attempts", async () => {
    let calls = 0;
    await expect(
      withTransientDbRetry(
        async () => {
          calls += 1;
          throw Object.assign(new Error("Connection terminated unexpectedly"), {
            code: "ECONNRESET",
          });
        },
        { attempts: 2 },
      ),
    ).rejects.toMatchObject({ code: "ECONNRESET" });
    expect(calls).toBe(2);
  });
});

describe("live pool recycle after backend terminate", () => {
  const rawUrl = process.env.DATABASE_URL;
  const skip = !rawUrl;

  it.skipIf(skip)("retries select 1 after the origin kills the idle client", async () => {
    const { default: pg } = await import("pg");
    resetPool();
    const pool = getPool();
    const first = await pool.query("select pg_backend_pid() as pid");
    const pid = Number(first.rows[0]?.pid);
    expect(pid).toBeGreaterThan(0);

    const killer = new pg.Client({ connectionString: rawUrl });
    await killer.connect();
    try {
      await killer.query("select pg_terminate_backend($1)", [pid]);
    } finally {
      await killer.end();
    }
    await new Promise((resolve) => setTimeout(resolve, 50));

    const retried = await withTransientDbRetry(() =>
      getPool().query("select 1::int as ok"),
    );
    expect(retried.rows[0]?.ok).toBe(1);
    resetPool();
  });
});
