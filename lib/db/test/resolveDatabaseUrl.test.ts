import { describe, expect, it } from "vitest";
import { resolveDatabaseUrl } from "../src/client";

describe("resolveDatabaseUrl", () => {
  it("reads DATABASE_URL, then POSTGRES_URL, then PRISMA_DATABASE_URL", () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: "postgresql://a/db" })).toBe(
      "postgresql://a/db",
    );
    expect(resolveDatabaseUrl({ POSTGRES_URL: "postgresql://b/db" })).toBe(
      "postgresql://b/db",
    );
    expect(
      resolveDatabaseUrl({ PRISMA_DATABASE_URL: "postgresql://c/db" }),
    ).toBe("postgresql://c/db");
    expect(resolveDatabaseUrl({ DATABASE_URL: "  " })).toBeUndefined();
  });
});
