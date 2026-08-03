import { describe, expect, it } from "vitest";
import { resolveDbConfig } from "@workspace/db";

describe("resolveDbConfig", () => {
  it("strips sslmode=require and enables encrypted SSL without CA verify", () => {
    const input =
      "postgresql://anima:s3cret@db.example.com:5432/anima_dev?sslmode=require";
    expect(resolveDbConfig(input)).toEqual({
      connectionString:
        "postgresql://anima:s3cret@db.example.com:5432/anima_dev",
      ssl: { rejectUnauthorized: false },
    });
  });

  it("preserves passwords that URL.toString would re-encode", () => {
    const input =
      "postgresql://anima:a+b=c@db.example.com:5432/anima_dev?sslmode=require&foo=1";
    const { connectionString, ssl } = resolveDbConfig(input);
    expect(connectionString).toBe(
      "postgresql://anima:a+b=c@db.example.com:5432/anima_dev?foo=1",
    );
    expect(connectionString).toContain("a+b=c");
    expect(connectionString).not.toContain("%3D");
    expect(ssl).toEqual({ rejectUnauthorized: false });
  });

  it("keeps sslmode=disable as an unencrypted connection", () => {
    expect(
      resolveDbConfig(
        "postgresql://anima:s3cret@localhost:5432/anima_dev?sslmode=disable",
      ),
    ).toEqual({
      connectionString: "postgresql://anima:s3cret@localhost:5432/anima_dev",
      ssl: false,
    });
  });

  it("defaults to encrypted SSL when sslmode is absent", () => {
    expect(
      resolveDbConfig("postgresql://anima:s3cret@db.example.com:5432/anima_dev"),
    ).toEqual({
      connectionString:
        "postgresql://anima:s3cret@db.example.com:5432/anima_dev",
      ssl: { rejectUnauthorized: false },
    });
  });
});
