import { afterEach, describe, expect, it, vi } from "vitest";

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
});
