import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Express } from "express";

describe("app health checks", () => {
  let app: Express;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.OPENAI_API_KEY;
    process.env.CLERK_PUBLISHABLE_KEY = "not-a-valid-clerk-key";
    process.env.CLERK_SECRET_KEY = "not-a-valid-clerk-secret";

    ({ default: app } = await import("../src/app"));

    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Test server did not bind to a TCP port."));
          return;
        }
        baseUrl = `http://127.0.0.1:${address.port}`;
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  it("keeps healthz public and independent of Clerk configuration", async () => {
    const response = await fetch(`${baseUrl}/api/healthz`);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "ok" });
  });

  it("does not 500 Character store reads when Clerk publishable key is invalid", async () => {
    const response = await fetch(`${baseUrl}/api/store/Character`);

    // Invalid CLERK_PUBLISHABLE_KEY is recovered via host-derived key, so the
    // request reaches requireUser as signed-out (401) instead of crashing (500)
    // or hard-failing config (503).
    expect([401, 503]).toContain(response.status);
    expect(response.status).not.toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("exposes a public database readiness probe", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/db`);
    // Local CI has a real DATABASE_URL → 200; a dead URL would be 503 with
    // target metadata. Either way the probe must not 404/500.
    expect([200, 503]).toContain(response.status);
    const body = await response.json();
    expect(body).toMatchObject({
      status: expect.stringMatching(/^(ok|error)$/),
      target: expect.objectContaining({ configured: true }),
    });
    if (response.status === 200) {
      expect(body.schema).toMatchObject({
        ok: true,
        missingTables: [],
      });
    }
  });

  it("exposes a public schema probe that can self-heal via POST", async () => {
    const getRes = await fetch(`${baseUrl}/api/healthz/schema`);
    expect([200, 503]).toContain(getRes.status);
    const getBody = await getRes.json();
    expect(getBody).toMatchObject({
      status: expect.stringMatching(/^(ok|error)$/),
      target: expect.objectContaining({ configured: true }),
    });

    const postRes = await fetch(`${baseUrl}/api/healthz/schema`, {
      method: "POST",
    });
    expect([200, 503]).toContain(postRes.status);
    const postBody = await postRes.json();
    expect(postBody).toMatchObject({
      status: expect.stringMatching(/^(ok|error)$/),
      ensured: expect.objectContaining({
        ok: expect.any(Boolean),
        missingBefore: expect.any(Array),
        createdTables: expect.any(Array),
      }),
    });
  });
});
