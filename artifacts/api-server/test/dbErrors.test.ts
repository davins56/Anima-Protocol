import { describe, expect, it } from "vitest";
import { classifyDbError, databaseTargetHint } from "../src/lib/dbErrors";

describe("classifyDbError", () => {
  it("marks connection refused as a database error", () => {
    const err = Object.assign(new Error("connect ECONNREFUSED 1.2.3.4:5432"), {
      code: "ECONNREFUSED",
    });
    expect(classifyDbError(err)).toMatchObject({
      isDbError: true,
      safeMessage: "Database host unreachable",
      code: "ECONNREFUSED",
    });
  });

  it("marks drizzle Failed query wrappers as database errors", () => {
    expect(
      classifyDbError(new Error("Failed query: select 1\nparams:")),
    ).toMatchObject({
      isDbError: true,
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
      safeMessage: "Database host unreachable",
      code: "ENOTFOUND",
    });
  });

  it("does not treat unrelated errors as database failures", () => {
    expect(classifyDbError(new Error("Publishable key not valid."))).toEqual({
      isDbError: false,
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
    expect(info.safeMessage).toBe("Database authentication failed");
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
    expect(databaseTargetHint("")).toEqual({ configured: false });
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
      safeMessage: "Database schema is missing or out of date",
      code: "42P01",
    });
  });
});
