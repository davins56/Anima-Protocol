import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CLOUDFLARE_RUNTIME_ENV_NAMES,
  mirrorCloudflareBindings,
  resolveDatabaseUrl,
} from "../src/lib/cloudflareEnv";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("mirrorCloudflareBindings", () => {
  it("copies non-enumerable secret bindings that Object.entries would skip", () => {
    const env: Record<string, unknown> = { NODE_ENV: "production" };
    Object.defineProperty(env, "CLERK_SECRET_KEY", {
      value: "sk_live_test",
      enumerable: false,
    });
    Object.defineProperty(env, "CLERK_PUBLISHABLE_KEY", {
      value: "pk_live_test",
      enumerable: false,
    });
    Object.defineProperty(env, "DATABASE_URL", {
      value: "postgresql://anima:anima@db/anima",
      enumerable: false,
    });

    expect(Object.entries(env).map(([key]) => key)).toEqual(["NODE_ENV"]);

    const target: Record<string, string | undefined> = {};
    mirrorCloudflareBindings(env, target);

    expect(target.NODE_ENV).toBe("production");
    expect(target.CLERK_SECRET_KEY).toBe("sk_live_test");
    expect(target.CLERK_PUBLISHABLE_KEY).toBe("pk_live_test");
    expect(target.DATABASE_URL).toBe("postgresql://anima:anima@db/anima");
  });

  it("aliases POSTGRES_URL onto DATABASE_URL when the primary name is unset", () => {
    const env: Record<string, unknown> = {};
    Object.defineProperty(env, "POSTGRES_URL", {
      value: "postgresql://from-alias/db",
      enumerable: false,
    });
    const target: Record<string, string | undefined> = {};
    mirrorCloudflareBindings(env, target);
    expect(target.DATABASE_URL).toBe("postgresql://from-alias/db");
  });

  it("includes every name from the production secret list", () => {
    const listed = readFileSync(
      path.join(repoRoot, "scripts/cloudflare/production-secret-names.txt"),
      "utf8",
    )
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    expect(CLOUDFLARE_RUNTIME_ENV_NAMES).toEqual(
      expect.arrayContaining(listed),
    );
  });
});

describe("resolveDatabaseUrl", () => {
  it("prefers DATABASE_URL then POSTGRES_URL then PRISMA_DATABASE_URL", () => {
    expect(
      resolveDatabaseUrl({ POSTGRES_URL: "postgresql://pg/db" }),
    ).toBe("postgresql://pg/db");
    expect(
      resolveDatabaseUrl({
        DATABASE_URL: " postgresql://primary/db ",
        POSTGRES_URL: "postgresql://pg/db",
      }),
    ).toBe("postgresql://primary/db");
    expect(
      resolveDatabaseUrl({ PRISMA_DATABASE_URL: "postgresql://prisma/db" }),
    ).toBe("postgresql://prisma/db");
    expect(resolveDatabaseUrl({})).toBeUndefined();
  });
});
