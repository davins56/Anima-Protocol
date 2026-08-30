import { afterEach, describe, expect, it } from "vitest";
import {
  bindRequestEnv,
  resetCloudflareEnvBindingsForTests,
} from "../src/lib/cloudflareEnv";
import { classifyDbError, databaseTargetHint } from "../src/lib/dbErrors";

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
    expect(classifyDbError(new Error("Publishable key not valid."))).toEqual({
      isDbError: false,
      reason: "internal",
      safeMessage: "Internal server error",
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
