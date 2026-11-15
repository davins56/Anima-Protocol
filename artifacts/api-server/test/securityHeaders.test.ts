import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  API_CSP,
  DOCUMENT_SECURITY_HEADERS,
  HSTS_VALUE,
  httpsRedirectFor,
  securityHeaderKindForPath,
  securityHeadersMiddleware,
  withSecurityHeaders,
} from "../src/lib/securityHeaders";
import cspReportRouter, { summarizeCspReport } from "../src/routes/cspReport";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

describe("public/_headers", () => {
  const file = readFileSync(path.join(repoRoot, "artifacts/anima-protocol/public/_headers"), "utf8");

  it("keeps the long-cache rule for hashed assets", () => {
    expect(file).toContain("/assets/*");
    expect(file).toContain("max-age=31536000, immutable");
  });

  it("sets every document security header on /* with the same values as the Worker", () => {
    const block = file.slice(file.indexOf("\n/*\n"));
    expect(block.length).toBeGreaterThan(10);
    for (const [name, value] of Object.entries(DOCUMENT_SECURITY_HEADERS)) {
      expect(block).toContain(`  ${name}: ${value}\n`);
    }
  });

  it("ships the document CSP as report-only and forbids framing", () => {
    expect(DOCUMENT_SECURITY_HEADERS).not.toHaveProperty("Content-Security-Policy");
    const csp = DOCUMENT_SECURITY_HEADERS["Content-Security-Policy-Report-Only"];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("https://clerk.anima-protocol.com");
    expect(csp).toContain("report-uri /api/csp-report");
    expect(DOCUMENT_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
  });
});

describe("httpsRedirectFor", () => {
  it("301s plain http GET to https, keeping path and query", () => {
    const res = httpsRedirectFor(new Request("http://anima-protocol.com/chat?x=1"));
    expect(res?.status).toBe(301);
    expect(res?.headers.get("location")).toBe("https://anima-protocol.com/chat?x=1");
    expect(res?.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
  });

  it("uses 308 for non-GET so the method and body survive", () => {
    const res = httpsRedirectFor(new Request("http://anima-protocol.com/api/store/x", { method: "POST", body: "{}" }));
    expect(res?.status).toBe(308);
  });

  it("leaves https and loopback (wrangler dev) alone", () => {
    expect(httpsRedirectFor(new Request("https://anima-protocol.com/"))).toBeNull();
    expect(httpsRedirectFor(new Request("http://localhost:8787/api/healthz"))).toBeNull();
    expect(httpsRedirectFor(new Request("http://127.0.0.1:8787/"))).toBeNull();
  });
});

describe("withSecurityHeaders", () => {
  it("adds the API headers and keeps status, body and existing headers", async () => {
    const res = withSecurityHeaders(
      new Response('{"ok":true}', { status: 418, headers: { "content-type": "application/json", "x-keep": "1" } }),
      "api",
    );
    expect(res.status).toBe(418);
    expect(res.headers.get("x-keep")).toBe("1");
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await res.text()).toBe('{"ok":true}');
  });

  it("gives the Clerk proxy transport headers only", () => {
    expect(securityHeaderKindForPath("/api/__clerk/v1/client")).toBe("clerk-proxy");
    expect(securityHeaderKindForPath("/api/store/x")).toBe("api");
    expect(securityHeaderKindForPath("/assets/index-abc123.js")).toBe("document");
    const res = withSecurityHeaders(new Response("x"), "clerk-proxy");
    expect(res.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
    expect(res.headers.get("content-security-policy")).toBeNull();
    expect(res.headers.get("x-frame-options")).toBeNull();
  });
});

describe("Express wiring", () => {
  let server: Server;
  let base = "";

  beforeAll(async () => {
    const app = express();
    app.use(securityHeadersMiddleware);
    app.use("/api", cspReportRouter);
    app.get("/api/thing", (_req, res) => {
      res.json({ ok: true });
    });
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("sets HSTS, nosniff, referrer, frame and CSP headers on API responses", async () => {
    const res = await fetch(`${base}/api/thing`);
    expect(res.headers.get("strict-transport-security")).toBe(HSTS_VALUE);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toBe(API_CSP);
  });

  it("accepts a CSP report and answers 204", async () => {
    const res = await fetch(`${base}/api/csp-report`, {
      method: "POST",
      headers: { "content-type": "application/csp-report" },
      body: JSON.stringify({
        "csp-report": {
          "document-uri": "https://anima-protocol.com/chat?token=secret",
          "violated-directive": "script-src",
          "blocked-uri": "https://evil.example/x.js?k=1",
        },
      }),
    });
    expect(res.status).toBe(204);
  });
});

describe("summarizeCspReport", () => {
  it("drops query strings and caps the batch", () => {
    const [first] = summarizeCspReport({
      "csp-report": {
        "document-uri": "https://anima-protocol.com/chat?token=secret",
        "effective-directive": "img-src",
        "blocked-uri": "https://cdn.example/a.png?sig=abc",
      },
    });
    expect(first).toEqual({
      directive: "img-src",
      blocked: "https://cdn.example/a.png",
      document: "https://anima-protocol.com/chat",
      disposition: undefined,
    });
    expect(summarizeCspReport(Array.from({ length: 50 }, () => ({ body: {} })))).toHaveLength(10);
  });
});
