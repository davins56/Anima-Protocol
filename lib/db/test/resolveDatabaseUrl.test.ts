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

  it("falls back to the Worker runtime env reader when process.env is empty", () => {
    const key = Symbol.for("anima.cloudflare.readRuntimeEnv");
    const previous = (globalThis as Record<PropertyKey, unknown>)[key];
    (globalThis as Record<PropertyKey, unknown>)[key] = (name: string) =>
      name === "DATABASE_URL" ? "postgresql://from-importable/db" : undefined;
    try {
      expect(resolveDatabaseUrl({})).toBe("postgresql://from-importable/db");
    } finally {
      if (previous === undefined) {
        delete (globalThis as Record<PropertyKey, unknown>)[key];
      } else {
        (globalThis as Record<PropertyKey, unknown>)[key] = previous;
      }
    }
  });
});
