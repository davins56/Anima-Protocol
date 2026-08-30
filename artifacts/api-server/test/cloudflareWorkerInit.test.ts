import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

/**
 * Cloudflare validates a Worker by evaluating the module graph. Secrets such
 * as DATABASE_URL live on env bindings and are only copied into process.env
 * on the first /api request (worker.ts). Import-time throws fail version
 * upload with error 10021.
 */
describe("Cloudflare Worker module init", () => {
  const savedDatabaseUrl = process.env.DATABASE_URL;
  const savedClerkSecret = process.env.CLERK_SECRET_KEY;

  afterEach(() => {
    if (savedDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedDatabaseUrl;
    }
    if (savedClerkSecret === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = savedClerkSecret;
    }
  });

  it("imports the Express app without DATABASE_URL or CLERK_SECRET_KEY", async () => {
    delete process.env.DATABASE_URL;
    delete process.env.CLERK_SECRET_KEY;
    vi.resetModules();

    await expect(import("../src/app")).resolves.toMatchObject({
      default: expect.anything(),
    });
  });

  it("defers the local db pool until DATABASE_URL is read", async () => {
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const mod = await import("../src/db/index");
    expect(mod.db).toBeDefined();
    expect(() => {
      void mod.pool.options;
    }).toThrow(/DATABASE_URL must be set/);
  });

  it("Worker DB entrypoint is lazy and uses the Worker-safe postgres.js client", () => {
    const workerDb = readFileSync(
      path.join(repoRoot, "artifacts/api-server/src/db/index.ts"),
      "utf8",
    );
    const bootstrap = readFileSync(
      path.join(
        repoRoot,
        "artifacts/api-server/src/lib/cloudflareEnvBootstrap.ts",
      ),
      "utf8",
    );
    const sharedClient = readFileSync(
      path.join(repoRoot, "lib/db/src/client.ts"),
      "utf8",
    );

    expect(workerDb).not.toMatch(/new Pool\s*\(/);
    expect(workerDb).toMatch(/getDbDriver\(\) === "postgres-js"/);
    expect(workerDb).toMatch(/createPostgresJsSql/);
    expect(workerDb).toMatch(/drizzle-orm\/postgres-js/);
    expect(bootstrap).toMatch(/ANIMA_DB_DRIVER/);
    expect(bootstrap).toMatch(/postgres-js/);
    expect(bootstrap).toMatch(/bindImportableEnv/);
    expect(bootstrap).not.toMatch(/mirrorCloudflareBindings/);
    expect(bootstrap).not.toMatch(/unwrapHyperdriveConnectionString/);
    expect(bootstrap).not.toMatch(/aliasHyperdriveUrl/);
    expect(bootstrap).not.toMatch(/env\.HYPERDRIVE/);
    expect(sharedClient).toMatch(/getDbDriver\(\) === "postgres-js"/);
    expect(sharedClient).toMatch(/drizzle-orm\/postgres-js/);
  });

  it("does not read Hyperdrive.connectionString during module bootstrap", async () => {
    let allowHyperdriveIo = false;
    const env = {
      NODE_ENV: "production",
      DATABASE_URL:
        "postgresql://direct:s3cret@db.supabase.co:5432/postgres?sslmode=require",
      HYPERDRIVE: {
        get connectionString() {
          if (!allowHyperdriveIo) {
            throw new Error(
              "Disallowed operation called within global scope. Asynchronous I/O (ex: fetch() or connect()), setting a timeout, and generating random values are not allowed within global scope.",
            );
          }
          return "postgresql://hd:hdpass@hyperdrive.local:5432/postgres";
        },
      },
    };

    delete process.env.DATABASE_URL;
    vi.resetModules();
    vi.doMock("cloudflare:workers", () => ({ env }));

    try {
      await expect(
        import("../src/lib/cloudflareEnvBootstrap"),
      ).resolves.toBeDefined();

      const {
        applyCloudflareRequestEnv,
        readRuntimeDatabaseUrl,
        resetCloudflareEnvBindingsForTests,
      } = await import("../src/lib/cloudflareEnv");

      expect(readRuntimeDatabaseUrl()).toBe(
        "postgresql://direct:s3cret@db.supabase.co:5432/postgres?sslmode=require",
      );

      allowHyperdriveIo = true;
      const target: Record<string, string | undefined> = {};
      await applyCloudflareRequestEnv(env, target);
      expect(target.DATABASE_URL).toBe(
        "postgresql://hd:hdpass@hyperdrive.local:5432/postgres",
      );
      resetCloudflareEnvBindingsForTests();
    } finally {
      vi.doUnmock("cloudflare:workers");
      vi.resetModules();
    }
  });
});
