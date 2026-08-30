import { afterEach, describe, expect, it } from "vitest";
import {
  bindRequestEnv,
  resetCloudflareEnvBindingsForTests,
} from "../src/lib/cloudflareEnv";
import {
  classifyDbError,
  databaseTargetHint,
  secretFreeErrorSignal,
} from "../src/lib/dbErrors";

afterEach(() => {
  resetCloudflareEnvBindingsForTests();
});

describe("classifyDbError", () => {
  it("marks connection refused as a database error", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:5432"), {
      code: "ECONNREFUSED",
    });
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "refused",
      safeMessage: "Database connection refused",
      code: "ECONNREFUSED",
    });
  });

  it("marks drizzle Failed query wrappers as database errors", () => {
    expect(
      classifyDbError(new Error("Failed query: select 1\nparams:")),
    ).toMatchObject({
      isDbError: true,
      reason: "unavailable",
      safeMessage: "Database unavailable",
    });
  });

  it("unwraps ENOTFOUND from Error.cause under a drizzle Failed query wrapper", () => {
    const cause = Object.assign(
      new Error("getaddrinfo ENOTFOUND db.example.com"),
      { code: "ENOTFOUND" },
    );
    const wrapped = new Error("Failed query: select 1\nparams:");
    (wrapped as Error & { cause?: unknown }).cause = cause;
    expect(classifyDbError(wrapped)).toMatchObject({
      isDbError: true,
      reason: "unreachable",
      safeMessage: "Database host unreachable",
      code: "ENOTFOUND",
    });
  });

  it("does not treat unrelated errors as database failures", () => {
    expect(classifyDbError(new Error("Publishable key not valid."))).toMatchObject({
      isDbError: false,
      reason: "internal",
      safeMessage: "Internal server error",
      code: "internal",
    });
  });

  it("redacts connection strings from messages used as fallbacks", () => {
    const info = classifyDbError(
      new Error(
        'password authentication failed for user "x" postgresql://u:p@host/db',
      ),
    );
    expect(info.isDbError).toBe(true);
    expect(info.safeMessage).not.toMatch(/postgresql:/);
    expect(info.safeMessage).not.toMatch(/s3cret|password=/i);
    expect(info.safeMessage).toBe("Database authentication failed");
    expect(info.reason).toBe("auth");
  });

  it("classifies timeout, ssl, and refused as distinct reasons", () => {
    expect(
      classifyDbError(
        Object.assign(new Error("timeout expired"), { code: "ETIMEDOUT" }),
      ),
    ).toMatchObject({
      reason: "timeout",
      code: "ETIMEDOUT",
      safeMessage: "Database connection timed out",
    });
    expect(
      classifyDbError(
        Object.assign(new Error("write EPROTO SSL routines"), {
          code: "ERR_SSL_WRONG_VERSION_NUMBER",
        }),
      ),
    ).toMatchObject({
      reason: "ssl",
      code: "ERR_SSL_WRONG_VERSION_NUMBER",
      safeMessage: "Database SSL connection failed",
    });
    expect(
      classifyDbError(new Error("connect ECONNREFUSED 127.0.0.1:5432")),
    ).toMatchObject({
      reason: "refused",
      safeMessage: "Database connection refused",
    });
    expect(
      classifyDbError(new Error("Connection terminated unexpectedly")),
    ).toMatchObject({
      reason: "reset",
      safeMessage: "Database connection reset",
    });
  });

  it("classifies a real TCP failure without leaking the password", async () => {
    const { Client } = await import("pg");
    const client = new Client({
      connectionString: "postgresql://x:s3cret@127.0.0.1:1/db",
      connectionTimeoutMillis: 500,
    });
    try {
      await client.connect();
      throw new Error("expected connect to fail");
    } catch (err) {
      if (err instanceof Error && err.message === "expected connect to fail") {
        throw err;
      }
      const info = classifyDbError(err);
      expect(info.isDbError).toBe(true);
      expect(["refused", "timeout", "reset"]).toContain(info.reason);
      expect(info.safeMessage).not.toMatch(/s3cret|postgresql:\/\//i);
      expect(info.code).toEqual(expect.any(String));
    } finally {
      await client.end().catch(() => undefined);
    }
  });
});

describe("databaseTargetHint", () => {
  it("returns host metadata without credentials", () => {
    expect(
      databaseTargetHint(
        "postgresql://anima:s3cret@db.example.com:5432/anima_dev?sslmode=require",
      ),
    ).toEqual({
      configured: true,
      source: "database_url",
      protocol: "postgresql",
      host: "db.example.com",
      port: "5432",
      database: "anima_dev",
      sslmode: "require",
    });
  });

  it("extracts host via regex when the password breaks URL()", () => {
    expect(
      databaseTargetHint(
        "postgresql://anima:p@ss=word@db.example.com:5432/anima_dev?sslmode=require",
      ),
    ).toMatchObject({
      configured: true,
      host: "db.example.com",
      port: "5432",
      database: "anima_dev",
      sslmode: "require",
    });
  });

  it("reports when DATABASE_URL is missing", () => {
    expect(databaseTargetHint("")).toEqual({
      configured: false,
      source: "none",
    });
  });

  it("marks Hyperdrive as the source without leaking the password", () => {
    bindRequestEnv({
      HYPERDRIVE: {
        connectionString:
          "postgresql://hd:s3cret@hyperdrive.local:5432/postgres",
      },
    });
    const hint = databaseTargetHint(
      "postgresql://hd:s3cret@hyperdrive.local:5432/postgres",
    );
    expect(hint).toMatchObject({
      configured: true,
      source: "hyperdrive",
      host: "hyperdrive.local",
      port: "5432",
    });
    expect(JSON.stringify(hint)).not.toMatch(/s3cret|postgresql:\/\//i);
  });
});

describe("classifyDbError schema signals", () => {
  it("maps undefined_table / does not exist to schema-missing message", () => {
    const err = Object.assign(
      new Error('relation "user_entities" does not exist'),
      { code: "42P01" },
    );
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "schema",
      safeMessage: "Database schema is missing or out of date",
      code: "42P01",
    });
  });
});

describe("classifyDbError query failures", () => {
  it("classifies postgres.js 22P02 malformed array literal as a DB query error", () => {
    const err = Object.assign(
      new Error(
        'malformed array literal: "user_entities,user_profiles,push_subscriptions"',
      ),
      { code: "22P02", name: "PostgresError", severity: "ERROR" },
    );
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "unavailable",
      safeMessage: "Database query failed",
      code: "22P02",
    });
    expect(classifyDbError(err).safeMessage).not.toBe("Internal server error");
  });

  it("classifies a non-Error driver object that only has code + message", () => {
    const info = classifyDbError({
      code: "22P02",
      message: 'malformed array literal: "a,b,c"',
    });
    expect(info).toMatchObject({
      isDbError: true,
      reason: "unavailable",
      safeMessage: "Database query failed",
      code: "22P02",
    });
  });

  it("still does not treat unrelated app errors as database failures", () => {
    expect(classifyDbError(new Error("Publishable key not valid."))).toMatchObject({
      isDbError: false,
      reason: "internal",
      safeMessage: "Internal server error",
    });
  });
}

describe("classifyDbError Hyperdrive / postgres.js", () => {
  it("classifies postgres.js write CONNECT_TIMEOUT as a DB timeout", () => {
    const err = Object.assign(new Error("write CONNECT_TIMEOUT"), {
      code: "CONNECT_TIMEOUT",
      errno: "CONNECT_TIMEOUT",
    });
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "timeout",
      safeMessage: "Database connection timed out",
      code: "CONNECT_TIMEOUT",
    });
    expect(classifyDbError(err).safeMessage).not.toBe("Internal server error");
  });

  it("classifies postgres.js CONNECT_ERROR as a refused DB error", () => {
    const err = Object.assign(new Error("write CONNECT_ERROR"), {
      code: "CONNECT_ERROR",
    });
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "refused",
      safeMessage: "Database connection refused",
      code: "CONNECT_ERROR",
    });
  });

  it("classifies CONNECTION_CLOSED as a DB reset", () => {
    const err = Object.assign(new Error("write CONNECTION_CLOSED"), {
      code: "CONNECTION_CLOSED",
    });
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "reset",
      code: "CONNECTION_CLOSED",
    });
  });

  it("classifies Hyperdrive origin-not-postgres throws as a DB error", () => {
    const err = new Error(
      "Hyperdrive could not connect to origin database: invalid startup packet",
    );
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "unavailable",
      safeMessage: "Database unavailable",
    });
    expect(classifyDbError(err).signal).toMatch(/hyperdrive|startup/i);
    expect(JSON.stringify(classifyDbError(err))).not.toMatch(
      /postgresql:\/\/|password=/i,
    );
  });

  it("exposes a secret-free signal without leaking the connection string", () => {
    const info = secretFreeErrorSignal(
      Object.assign(
        new Error("write CONNECT_TIMEOUT postgresql://hd:s3cret@hyperdrive.local/db"),
        { code: "CONNECT_TIMEOUT" },
      ),
    );
    expect(info.code).toBe("CONNECT_TIMEOUT");
    expect(info.signal).toMatch(/CONNECT_TIMEOUT/);
    expect(info.signal).not.toMatch(/s3cret|postgresql:\/\//i);
  });

  it("classifies PostgresError name as a database failure", () => {
    const err = Object.assign(new Error("too many clients already"), {
      name: "PostgresError",
      code: "53300",
    });
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      reason: "limit",
      code: "53300",
    });
  });
}););

