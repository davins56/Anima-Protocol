import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const entry = resolve(repoRoot, "api/index.mjs");

describe("Vercel serverless entry", () => {
  it("keeps api/index.mjs committed so deploy-scan matches vercel.json functions", () => {
    const vercel = JSON.parse(
      readFileSync(resolve(repoRoot, "vercel.json"), "utf8"),
    ) as {
      functions?: Record<string, { maxDuration?: number }>;
      rewrites?: Array<{ source?: string; destination?: string }>;
    };

    expect(vercel.functions).toEqual(
      expect.objectContaining({
        "api/index.mjs": expect.objectContaining({ maxDuration: 60 }),
      }),
    );
    expect(vercel.rewrites).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "/api/(.*)",
          destination: "/api",
        }),
      ]),
    );

    expect(existsSync(entry)).toBe(true);

    const source = readFileSync(entry, "utf8");
    expect(source).toMatch(
      /export\s+default\b|export\s*\{[\s\S]*\bas default\b/,
    );
    expect(source).toContain("/api/__clerk");
    expect(source).toContain("/healthz");
  });
});

describe("generated Vercel bundle serves /api", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    process.env.CLERK_PUBLISHABLE_KEY ??= "pk_test_placeholder";
    process.env.CLERK_SECRET_KEY ??= "sk_test_placeholder";

    ({ default: app } = await import(entry));

    await new Promise<void>((resolveListen, reject) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Test server did not bind to a TCP port."));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolveListen();
      });
    });
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolveClose, reject) => {
      server.close((err) => (err ? reject(err) : resolveClose()));
    });
  });

  it("serves /api/healthz from the committed bundle", async () => {
    const response = await fetch(`${baseUrl}/api/healthz`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("serves /api/__clerk instead of 404 so GitHub OAuth can start", async () => {
    const response = await fetch(`${baseUrl}/api/__clerk/v1/environment`);
    expect(response.status).not.toBe(404);
    expect([200, 400, 401, 403, 502, 503]).toContain(response.status);
    const contentType = response.headers.get("content-type") ?? "";
    expect(contentType).toMatch(/json/);
  });
});
