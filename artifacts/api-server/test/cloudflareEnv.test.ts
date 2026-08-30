import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  CLOUDFLARE_RUNTIME_ENV_NAMES,
  applyCloudflareRequestEnv,
  bindImportableEnv,
  bindRequestEnv,
  mirrorCloudflareBindings,
  readRuntimeDatabaseUrl,
  readRuntimeEnv,
  remirrorRuntimeEnvIntoProcess,
  resetCloudflareEnvBindingsForTests,
  resolveDatabaseUrl,
  runtimeEnvPresence,
  unwrapBindingString,
  unwrapBindingStringAsync,
} from "../src/lib/cloudflareEnv";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

afterEach(() => {
  resetCloudflareEnvBindingsForTests();
});

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

  it("unwraps Secrets Store-style { value } objects", () => {
    const env: Record<string, unknown> = {
      CLERK_SECRET_KEY: { value: "sk_live_wrapped" },
      DATABASE_URL: { value: "postgresql://wrapped/db" },
    };
    const target: Record<string, string | undefined> = {};
    mirrorCloudflareBindings(env, target);
    expect(target.CLERK_SECRET_KEY).toBe("sk_live_wrapped");
    expect(target.DATABASE_URL).toBe("postgresql://wrapped/db");
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

function withWipedProcessSecrets(run: () => void | Promise<void>) {
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    CLERK_SECRET_KEY: process.env.CLERK_SECRET_KEY,
    CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY,
    POSTGRES_URL: process.env.POSTGRES_URL,
    PRISMA_DATABASE_URL: process.env.PRISMA_DATABASE_URL,
  };
  delete process.env.DATABASE_URL;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.CLERK_PUBLISHABLE_KEY;
  delete process.env.POSTGRES_URL;
  delete process.env.PRISMA_DATABASE_URL;
  const restore = () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = run();
    if (result && typeof (result as Promise<void>).then === "function") {
      return (result as Promise<void>).finally(restore);
    }
    restore();
    return result;
  } catch (err) {
    restore();
    throw err;
  }
}

describe("importable and request-time env", () => {
  it("reads non-enumerable importable env after process.env is wiped", () =>
    withWipedProcessSecrets(() => {
      const importable: Record<string, unknown> = { NODE_ENV: "production" };
      Object.defineProperty(importable, "CLERK_SECRET_KEY", {
        value: "sk_live_importable",
        enumerable: false,
      });
      Object.defineProperty(importable, "DATABASE_URL", {
        value: "postgresql://from-importable/db",
        enumerable: false,
      });
      bindImportableEnv(importable);

      expect(readRuntimeEnv("CLERK_SECRET_KEY")).toBe("sk_live_importable");
      expect(readRuntimeDatabaseUrl()).toBe("postgresql://from-importable/db");
      expect(runtimeEnvPresence()).toEqual({
        hasDatabaseUrl: true,
        hasClerkSecret: true,
        hasClerkPublishable: false,
      });

      const target: Record<string, string | undefined> = {};
      remirrorRuntimeEnvIntoProcess(target);
      expect(target.CLERK_SECRET_KEY).toBe("sk_live_importable");
      expect(target.DATABASE_URL).toBe("postgresql://from-importable/db");
    }));

  it("applies async Secrets Store get() bindings from the request env", async () => {
    const env: Record<string, unknown> = {
      CLERK_PUBLISHABLE_KEY: {
        get: async () => "pk_live_store",
      },
      CLERK_SECRET_KEY: {
        get: async () => "sk_live_store",
      },
      DATABASE_URL: {
        get: async () => "postgresql://secrets-store/db",
      },
    };
    const target: Record<string, string | undefined> = {};
    await applyCloudflareRequestEnv(env, target);

    expect(target.CLERK_SECRET_KEY).toBe("sk_live_store");
    expect(target.CLERK_PUBLISHABLE_KEY).toBe("pk_live_store");
    expect(target.DATABASE_URL).toBe("postgresql://secrets-store/db");
    expect(unwrapBindingString(env.CLERK_SECRET_KEY)).toBeUndefined();
    expect(await unwrapBindingStringAsync(env.CLERK_SECRET_KEY)).toBe(
      "sk_live_store",
    );
  });

  it("restores cached secrets after a process.env snapshot wipe", async () => {
    const savedDb = process.env.DATABASE_URL;
    const savedClerk = process.env.CLERK_SECRET_KEY;
    const savedPk = process.env.CLERK_PUBLISHABLE_KEY;
    try {
      delete process.env.DATABASE_URL;
      delete process.env.CLERK_SECRET_KEY;
      delete process.env.CLERK_PUBLISHABLE_KEY;

      await applyCloudflareRequestEnv({
        CLERK_SECRET_KEY: "sk_live_cached",
        CLERK_PUBLISHABLE_KEY: "pk_live_cached",
        DATABASE_URL: "postgresql://cached/db",
      });

      delete process.env.DATABASE_URL;
      delete process.env.CLERK_SECRET_KEY;
      delete process.env.CLERK_PUBLISHABLE_KEY;

      expect(process.env.DATABASE_URL).toBeUndefined();
      remirrorRuntimeEnvIntoProcess();
      expect(process.env.CLERK_SECRET_KEY).toBe("sk_live_cached");
      expect(process.env.DATABASE_URL).toBe("postgresql://cached/db");
      expect(runtimeEnvPresence()).toEqual({
        hasDatabaseUrl: true,
        hasClerkSecret: true,
        hasClerkPublishable: true,
      });
    } finally {
      resetCloudflareEnvBindingsForTests();
      if (savedDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = savedDb;
      if (savedClerk === undefined) delete process.env.CLERK_SECRET_KEY;
      else process.env.CLERK_SECRET_KEY = savedClerk;
      if (savedPk === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
      else process.env.CLERK_PUBLISHABLE_KEY = savedPk;
    }
  });

  it("reads last request env even when process.env assignment is ignored", () =>
    withWipedProcessSecrets(() => {
      bindRequestEnv({
        DATABASE_URL: "postgresql://request-env/db",
        CLERK_SECRET_KEY: "sk_live_request",
      });
      expect(readRuntimeEnv("CLERK_SECRET_KEY")).toBe("sk_live_request");
      expect(readRuntimeDatabaseUrl()).toBe("postgresql://request-env/db");
    }));
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
