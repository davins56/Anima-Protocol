import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const srcDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../src",
);

const savedDriver = process.env.ANIMA_DB_DRIVER;
const savedDatabaseUrl = process.env.DATABASE_URL;

afterEach(async () => {
  if (savedDriver === undefined) delete process.env.ANIMA_DB_DRIVER;
  else process.env.ANIMA_DB_DRIVER = savedDriver;
  if (savedDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = savedDatabaseUrl;
  vi.resetModules();
});

describe("Worker-safe database driver", () => {
  it("does not construct a TCP Pool at module evaluation", async () => {
    delete process.env.ANIMA_DB_DRIVER;
    delete process.env.DATABASE_URL;
    vi.resetModules();

    const clientSource = readFileSync(path.join(srcDir, "client.ts"), "utf8");
    const driverSource = readFileSync(path.join(srcDir, "driver.ts"), "utf8");

    expect(clientSource).not.toMatch(/new Pool\s*\(/);
    expect(driverSource).toMatch(/new pg\.Pool/);
    expect(driverSource).toMatch(/createPostgresJsSql/);
    expect(clientSource).toMatch(/drizzle-orm\/postgres-js/);
    expect(clientSource).toMatch(/getDbDriver\(\) === "postgres-js"/);

    const { getDbDriver, getPool, resetDbClientsForTests } = await import(
      "../src/client"
    );
    resetDbClientsForTests();
    expect(getDbDriver()).toBe("node-pg");
    expect(() => getPool()).toThrow(/DATABASE_URL must be set/);
  });

  it("uses postgres.js on the Worker driver path instead of node-pg Pool", async () => {
    process.env.ANIMA_DB_DRIVER = "postgres-js";
    process.env.DATABASE_URL =
      "postgresql://anima:dev@127.0.0.1:5432/anima_dev?sslmode=disable";
    vi.resetModules();

    const { getDbDriver, getPool, resetDbClientsForTests } = await import(
      "../src/client"
    );
    resetDbClientsForTests();
    expect(getDbDriver()).toBe("postgres-js");

    const queryable = getPool();
    expect(queryable).not.toBeInstanceOf(pg.Pool);
    expect(typeof queryable.query).toBe("function");
  });

  it("keeps node-pg for local / Vercel when the Worker driver is not selected", async () => {
    process.env.ANIMA_DB_DRIVER = "node-pg";
    process.env.DATABASE_URL =
      "postgresql://anima:dev@127.0.0.1:5432/anima_dev?sslmode=disable";
    vi.resetModules();

    const { getDbDriver, getPool, resetDbClientsForTests } = await import(
      "../src/client"
    );
    resetDbClientsForTests();
    expect(getDbDriver()).toBe("node-pg");
    expect(getPool()).toBeInstanceOf(pg.Pool);
  });

  it("selects postgres-js when the Cloudflare Worker userAgent is present", async () => {
    const { getDbDriver, isCloudflareWorkerRuntime } = await import(
      "../src/driver"
    );
    expect(isCloudflareWorkerRuntime()).toBe(false);
    expect(
      isCloudflareWorkerRuntime({
        navigator: { userAgent: "Cloudflare-Workers" },
      } as typeof globalThis),
    ).toBe(true);
    expect(getDbDriver({ ANIMA_DB_DRIVER: "postgres-js" })).toBe("postgres-js");
    expect(getDbDriver({ ANIMA_DB_DRIVER: "node-pg" })).toBe("node-pg");
    expect(getDbDriver({})).toBe("node-pg");
  });

  it("does not force TLS against a Hyperdrive proxy socket", async () => {
    const { postgresJsSslOption } = await import("../src/driver");
    expect(
      postgresJsSslOption(
        "postgresql://hd:x@hyperdrive.local:5432/postgres",
        { rejectUnauthorized: false },
      ),
    ).toBe(false);
    expect(
      postgresJsSslOption(
        "postgresql://anima:x@db.example.com:5432/anima?sslmode=require",
        { rejectUnauthorized: false },
      ),
    ).toEqual({ rejectUnauthorized: false });
  });
});
