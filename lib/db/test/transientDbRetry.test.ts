import { afterEach, describe, expect, it } from "vitest";
import {
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
