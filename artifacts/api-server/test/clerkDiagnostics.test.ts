import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildClerkKeyReport,
  clerkDiagnosticStatus,
  decodeClerkFrontendHost,
  keyTail,
  probeClerkInstance,
  resolveKeyPairing,
  secretKeyKind,
  summarizeClerkProbe,
  type ClerkKeyReport,
} from "../src/lib/clerkDiagnostics";

/** Production key whose payload decodes to clerk.anima-protocol.com$ */
const LIVE_CUSTOM_KEY = "pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA";
const LIVE_SECRET = "sk_live_0123456789abcdef10aa";
const TEST_SECRET = "sk_test_0123456789abcdef20bb";

const APEX_REQ = {
  headers: { host: "anima-protocol.com", origin: "https://anima-protocol.com" },
};

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.CLERK_PUBLISHABLE_KEY;
  delete process.env.CLERK_SECRET_KEY;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
});

describe("publishable key decoding", () => {
  it("decodes the Frontend API host from a live custom-domain key", () => {
    expect(decodeClerkFrontendHost(LIVE_CUSTOM_KEY)).toBe(
      "clerk.anima-protocol.com",
    );
  });

  it("rejects mojibake payloads like pk_test_placeholder", () => {
    expect(decodeClerkFrontendHost("pk_test_placeholder")).toBeNull();
    expect(decodeClerkFrontendHost("not-a-key")).toBeNull();
    expect(decodeClerkFrontendHost(undefined)).toBeNull();
  });

  it("returns only the last four characters of a key", () => {
    expect(keyTail(LIVE_SECRET)).toBe("10aa");
    expect(keyTail("abc")).toBeNull();
    expect(keyTail(undefined)).toBeNull();
  });
});

describe("key pairing", () => {
  it("classifies secret key environments", () => {
    expect(secretKeyKind(LIVE_SECRET)).toBe("live");
    expect(secretKeyKind(TEST_SECRET)).toBe("test");
    expect(secretKeyKind("nonsense")).toBeNull();
  });

  it("flags a pk_live paired with an sk_test", () => {
    expect(resolveKeyPairing("production", "live")).toBe("ok");
    expect(resolveKeyPairing("development", "test")).toBe("ok");
    expect(resolveKeyPairing("production", "test")).toBe(
      "mismatched-environment",
    );
    expect(resolveKeyPairing("production", null)).toBe("incomplete");
  });
});

describe("buildClerkKeyReport", () => {
  it("reports a healthy env-sourced pair without leaking secrets", () => {
    process.env.CLERK_PUBLISHABLE_KEY = LIVE_CUSTOM_KEY;
    process.env.CLERK_SECRET_KEY = LIVE_SECRET;

    const report = buildClerkKeyReport(APEX_REQ);

    expect(report.publishableKey.source).toBe("env");
    expect(report.publishableKey.valid).toBe(true);
    expect(report.publishableKey.instanceType).toBe("production");
    expect(report.publishableKey.frontendApiHost).toBe(
      "clerk.anima-protocol.com",
    );
    expect(report.secretKey.kind).toBe("live");
    expect(report.keyPairing).toBe("ok");
    expect(clerkDiagnosticStatus(report).status).toBe("ok");

    // No secret material anywhere in the payload.
    const serialized = JSON.stringify(report);
    expect(serialized).not.toContain(LIVE_SECRET);
    expect(serialized).not.toContain("sk_live_0123456789");
  });

  it("surfaces a mismatched live/test pair as an error", () => {
    process.env.CLERK_PUBLISHABLE_KEY = LIVE_CUSTOM_KEY;
    process.env.CLERK_SECRET_KEY = TEST_SECRET;

    const report = buildClerkKeyReport(APEX_REQ);

    expect(report.keyPairing).toBe("mismatched-environment");
    expect(clerkDiagnosticStatus(report)).toEqual({
      status: "error",
      httpStatus: 503,
    });
    expect(report.notes.join(" ")).toMatch(/different Clerk instances/i);
  });

  it("reports when a corrupt env key was silently derived from the host", () => {
    process.env.CLERK_PUBLISHABLE_KEY = "pk_test_placeholder";
    process.env.CLERK_SECRET_KEY = LIVE_SECRET;

    const report = buildClerkKeyReport(APEX_REQ);

    expect(report.publishableKey.present).toBe(true);
    expect(report.publishableKey.valid).toBe(false);
    expect(report.notes.join(" ")).toMatch(/silently derived/i);
  });

  it("flags a missing secret key", () => {
    process.env.CLERK_PUBLISHABLE_KEY = LIVE_CUSTOM_KEY;

    const report = buildClerkKeyReport(APEX_REQ);

    expect(report.secretKey.present).toBe(false);
    expect(clerkDiagnosticStatus(report).httpStatus).toBe(503);
    expect(report.notes.join(" ")).toMatch(/CLERK_SECRET_KEY is unset/);
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function reportFor(pk: string, sk: string): ClerkKeyReport {
  process.env.CLERK_PUBLISHABLE_KEY = pk;
  process.env.CLERK_SECRET_KEY = sk;
  return buildClerkKeyReport(APEX_REQ);
}

describe("probeClerkInstance", () => {
  it("confirms a match when JWKS key ids overlap", async () => {
    const report = reportFor(LIVE_CUSTOM_KEY, LIVE_SECRET);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("clerk.anima-protocol.com")) {
        return jsonResponse({ keys: [{ kid: "ins_shared_kid" }] });
      }
      if (url.includes("/v1/jwks")) {
        return jsonResponse({ keys: [{ kid: "ins_shared_kid" }] });
      }
      return jsonResponse({
        data: [
          {
            is_satellite: false,
            name: "anima-protocol.com",
            frontend_api_url: "https://clerk.anima-protocol.com",
          },
        ],
      });
    }) as unknown as typeof fetch;

    const probe = await probeClerkInstance(report, LIVE_SECRET, fetchImpl);

    expect(probe.instanceMatch).toBe(true);
    expect(probe.sharedKids).toEqual(["ins_shared_kid"]);
    expect(summarizeClerkProbe(report, probe)).toMatch(/same Clerk instance/i);
    expect(clerkDiagnosticStatus(report, probe).status).toBe("ok");
  });

  it("detects mismatched instances when key ids are disjoint", async () => {
    const report = reportFor(LIVE_CUSTOM_KEY, LIVE_SECRET);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("clerk.anima-protocol.com")) {
        return jsonResponse({ keys: [{ kid: "kid_from_anima" }] });
      }
      if (url.includes("/v1/jwks")) {
        return jsonResponse({ keys: [{ kid: "kid_from_other_app" }] });
      }
      return jsonResponse({
        data: [
          {
            is_satellite: false,
            name: "other-app.com",
            frontend_api_url: "https://clerk.other-app.com",
          },
        ],
      });
    }) as unknown as typeof fetch;

    const probe = await probeClerkInstance(report, LIVE_SECRET, fetchImpl);

    expect(probe.instanceMatch).toBe(false);
    expect(probe.sharedKids).toEqual([]);
    expect(probe.instanceDomains.primaryFrontendApiHost).toBe(
      "clerk.other-app.com",
    );

    const summary = summarizeClerkProbe(report, probe);
    expect(summary).toMatch(/Key mismatch/);
    expect(summary).toContain("clerk.other-app.com");
    expect(summary).toContain("clerk.anima-protocol.com");
    expect(clerkDiagnosticStatus(report, probe)).toEqual({
      status: "error",
      httpStatus: 503,
    });
  });

  it("reports a revoked secret key as a 401 from the Backend API", async () => {
    const report = reportFor(LIVE_CUSTOM_KEY, LIVE_SECRET);
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("clerk.anima-protocol.com")) {
        return jsonResponse({ keys: [{ kid: "kid_from_anima" }] });
      }
      return jsonResponse({ errors: [] }, 401);
    }) as unknown as typeof fetch;

    const probe = await probeClerkInstance(report, LIVE_SECRET, fetchImpl);

    expect(probe.instanceMatch).toBeNull();
    expect(probe.backendApiJwks.status).toBe(401);
    expect(summarizeClerkProbe(report, probe)).toMatch(/invalid or revoked/i);

    // A rejected secret key must not be reported as healthy just because
    // every presence check passed.
    expect(clerkDiagnosticStatus(report, probe)).toEqual({
      status: "error",
      httpStatus: 503,
    });
  });

  it("does not throw when the Frontend API is unreachable", async () => {
    const report = reportFor(LIVE_CUSTOM_KEY, LIVE_SECRET);
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    }) as unknown as typeof fetch;

    const probe = await probeClerkInstance(report, LIVE_SECRET, fetchImpl);

    expect(probe.instanceMatch).toBeNull();
    expect(probe.frontendApiJwks.error).toMatch(/ENOTFOUND/);
    // Unconfirmed is a warning, never a false "ok".
    expect(clerkDiagnosticStatus(report, probe).status).toBe("warn");
  });

  it("never puts the secret key in the probe payload", async () => {
    const report = reportFor(LIVE_CUSTOM_KEY, LIVE_SECRET);
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ keys: [{ kid: "kid_a", n: "PUBLIC_MODULUS" }] }),
    ) as unknown as typeof fetch;

    const probe = await probeClerkInstance(report, LIVE_SECRET, fetchImpl);
    const serialized = JSON.stringify(probe);

    expect(serialized).not.toContain(LIVE_SECRET);
    expect(serialized).not.toContain("PUBLIC_MODULUS");
  });
});
