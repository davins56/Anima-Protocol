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
    process.env.ADMIN_MIGRATION_SECRET = "test-schema-ops-secret";

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

  it("locks the env presence probe behind the ops bearer", async () => {
    const anon = await fetch(`${baseUrl}/api/healthz/env`);
    expect(anon.status).toBe(401);
    const wrong = await fetch(`${baseUrl}/api/healthz/env`, {
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(wrong.status).toBe(401);
  });

  it("exposes presence-only env flags without secret values to ops", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/env`, { headers: { Authorization: "Bearer test-schema-ops-secret" } });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      hasDatabaseUrl: expect.any(Boolean),
      hasClerkSecret: expect.any(Boolean),
      hasClerkPublishable: expect.any(Boolean),
    });
    expect(JSON.stringify(body)).not.toMatch(/sk_|pk_|postgresql:\/\//i);
    expect(body.hasDatabaseUrl).toBe(true);
  });

  it("returns a clear config error for store reads when Clerk publishable key is invalid", async () => {
    const response = await fetch(`${baseUrl}/api/store/Character`);

    // Invalid CLERK_PUBLISHABLE_KEY must never crash the API with a 500. The
    // middleware should surface a clear, typed server configuration error.
    expect(response.status).toBe(503);
    expect(response.status).not.toBe(500);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.any(String),
    });
  });

  it("locks the database readiness probe behind the ops bearer", async () => {
    const anon = await fetch(`${baseUrl}/api/healthz/db`);
    expect(anon.status).toBe(401);
    await expect(anon.json()).resolves.toMatchObject({ code: "ops_unauthorized" });
  });

  it("exposes an inspect-only database readiness probe to ops", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/db`, { headers: { Authorization: "Bearer test-schema-ops-secret" } });
    // Local CI has a real DATABASE_URL → 200; a dead URL would be 503 with
    // target metadata. Either way the probe must not 404/500.
    expect([200, 503]).toContain(response.status);
    const body = await response.json();
    expect(body).toMatchObject({
      status: expect.stringMatching(/^(ok|error)$/),
      target: expect.objectContaining({
        configured: true,
        source: expect.stringMatching(/^(hyperdrive|database_url)$/),
      }),
    });
    expect(JSON.stringify(body)).not.toMatch(/password=|postgresql:\/\/[^:]+:[^@]+@/i);
    if (response.status === 200) {
      expect(body.schema).toMatchObject({
        ok: true,
        missingTables: [],
      });
    } else {
      expect(body.reason).toMatch(
        /^(timeout|ssl|refused|reset|unreachable|auth|schema|limit|unavailable)$/,
      );
      expect(body.reason).not.toBe("internal");
      expect(body.code).toEqual(expect.any(String));
      if (body.db === false) {
        expect(body.signal).toEqual(expect.any(String));
      }
      expect(JSON.stringify(body)).not.toMatch(/postgresql:\/\/[^:]+:[^@]+@/);
    }
  });

  it("requires an ops bearer for GET schema inspect and for POST", async () => {
    const anonGet = await fetch(`${baseUrl}/api/healthz/schema`);
    expect(anonGet.status).toBe(401);
    const getRes = await fetch(`${baseUrl}/api/healthz/schema`, { headers: { Authorization: "Bearer test-schema-ops-secret" } });
    expect([200, 503]).toContain(getRes.status);
    const getBody = await getRes.json();
    expect(getBody).toMatchObject({
      status: expect.stringMatching(/^(ok|error)$/),
      target: expect.objectContaining({ configured: true }),
    });

    const unauth = await fetch(`${baseUrl}/api/healthz/schema`, {
      method: "POST",
    });
    expect(unauth.status).toBe(401);
    await expect(unauth.json()).resolves.toMatchObject({
      error: "Unauthorized",
      code: "ops_unauthorized",
    });

    const wrong = await fetch(`${baseUrl}/api/healthz/schema`, {
      method: "POST",
      headers: { Authorization: "Bearer wrong-secret" },
    });
    expect(wrong.status).toBe(401);

    const postRes = await fetch(`${baseUrl}/api/healthz/schema`, {
      method: "POST",
      headers: { Authorization: "Bearer test-schema-ops-secret" },
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

  it("answers /healthz/llm publicly with status and chain only", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/llm`);
    expect([200, 503]).toContain(response.status);
    const body = await response.json();
    expect(Object.keys(body).sort()).toEqual(["chain", "status"]);
    expect(Array.isArray(body.chain)).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/keyTail|openrouter|gateway|host/i);
  });

  it("shows full LLM routing to ops but never a key tail", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/llm`, { headers: { Authorization: "Bearer test-schema-ops-secret" } });
    const body = await response.json();
    expect(body).toHaveProperty("preferred");
    expect(body).toHaveProperty("openrouter");
    expect(JSON.stringify(body)).not.toContain("keyTail");
  });

  it("requires the ops bearer for a live LLM probe", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/llm?probe=1`);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ code: "ops_unauthorized" });
  });

  it("answers /healthz/clerk publicly with a bare status", async () => {
    const response = await fetch(`${baseUrl}/api/healthz/clerk`);
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["status"]);
  });

  it("shows the Clerk key report to ops without key tails, and gates the probe", async () => {
    const ops = await fetch(`${baseUrl}/api/healthz/clerk`, { headers: { Authorization: "Bearer test-schema-ops-secret" } });
    const body = await ops.json();
    expect(body).toHaveProperty("secretKey");
    expect(JSON.stringify(body)).not.toContain("keyTail");
    const probe = await fetch(`${baseUrl}/api/healthz/clerk?probe=1`);
    expect(probe.status).toBe(401);
  });
});
