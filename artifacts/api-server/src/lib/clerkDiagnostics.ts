/**
 * Secret-free Clerk configuration diagnostics.
 *
 * `/healthz/env` only reports presence booleans, which cannot distinguish
 * "CLERK_SECRET_KEY is set" from "CLERK_SECRET_KEY belongs to a different Clerk
 * instance than CLERK_PUBLISHABLE_KEY". The second case is invisible from
 * outside the box: sign-in succeeds in the browser against the real Frontend
 * API, then every authenticated route 401s because `getAuth(req)` yields no
 * userId. Symptom reads as "the app doesn't register my login" and, because
 * `requireUser()` gates every chat route, as "the AI characters don't respond".
 *
 * `resolveRuntimePublishableKey` makes that failure quieter still: an invalid
 * or corrupt CLERK_PUBLISHABLE_KEY is silently replaced by a key derived from
 * the request host, so nothing throws and nothing logs.
 *
 * This module reports, without ever returning a secret:
 *  - which publishable key the runtime resolved, and whether it came from env
 *    or was derived from the request host
 *  - the Frontend API host encoded in that key
 *  - whether the secret key is live/test, and whether that matches the
 *    publishable key's instance type
 *  - (probe mode) whether the secret key and the publishable key resolve to the
 *    SAME Clerk instance, proven by intersecting the JWKS `kid` sets from the
 *    Backend API (secret-key-derived) and the Frontend API
 *    (publishable-key-derived). `kid` values are public key identifiers.
 *
 * Only key tails (last 4 chars), hostnames, and `kid`s ever leave this module.
 */

import type { IncomingHttpHeaders } from "http";
import {
  isDevelopmentFromPublishableKey,
  isProductionFromPublishableKey,
  isPublishableKey,
} from "@clerk/shared/keys";
import { readRuntimeEnv } from "./cloudflareEnv";
import {
  getClerkProxyHost,
  resolveRuntimePublishableKey,
} from "../middlewares/clerkProxyHosts";

const CLERK_BACKEND_API = "https://api.clerk.com";
const PROBE_TIMEOUT_MS = 6_000;

/**
 * DNS hostname: letters, digits, hyphens, dots. Rejects mojibake produced by
 * base64-decoding placeholders such as `pk_test_placeholder`.
 */
const CLERK_FRONTEND_HOST_RE =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

export type PublishableKeySource = "env" | "derived-from-host" | "none";

export type KeyPairing =
  | "ok"
  | "mismatched-environment"
  | "incomplete";

export interface ClerkKeyReport {
  publishableKey: {
    present: boolean;
    valid: boolean;
    source: PublishableKeySource;
    instanceType: "production" | "development" | null;
    frontendApiHost: string | null;
    keyTail: string | null;
  };
  secretKey: {
    present: boolean;
    valid: boolean;
    kind: "live" | "test" | null;
    keyTail: string | null;
  };
  keyPairing: KeyPairing;
  requestHost: string | null;
  notes: string[];
}

export interface JwksProbe {
  ok: boolean;
  status: number | null;
  url: string;
  kids: string[];
  error?: string;
}

export interface DomainsProbe {
  ok: boolean;
  status: number | null;
  primaryFrontendApiHost: string | null;
  error?: string;
}

export interface ClerkProbeReport {
  frontendApiJwks: JwksProbe;
  backendApiJwks: JwksProbe;
  instanceDomains: DomainsProbe;
  /**
   * True when the secret key and the publishable key demonstrably belong to
   * the same Clerk instance. Null when a probe could not run.
   */
  instanceMatch: boolean | null;
  sharedKids: string[];
}

/** Last 4 characters of a key — enough to compare against a dashboard value. */
export function keyTail(key: string | undefined): string | null {
  const trimmed = (key ?? "").trim();
  return trimmed.length >= 4 ? trimmed.slice(-4) : null;
}

function decodeBase64(payload: string): string {
  if (typeof atob === "function") return atob(payload);
  if (typeof Buffer !== "undefined") {
    return Buffer.from(payload, "base64").toString("utf-8");
  }
  return "";
}

/**
 * Decodes the Frontend API host embedded in a Clerk publishable key.
 * Returns null unless the payload decodes to a plausible hostname.
 */
export function decodeClerkFrontendHost(
  clerkPubKey: string | undefined,
): string | null {
  if (typeof clerkPubKey !== "string") return null;
  const match = clerkPubKey.trim().match(/^pk_(?:live|test)_(.+)$/);
  if (!match) return null;
  try {
    const decoded = decodeBase64(match[1].replace(/\$$/, ""));
    const host = decoded.replace(/\$$/, "").trim();
    return CLERK_FRONTEND_HOST_RE.test(host) ? host : null;
  } catch {
    return null;
  }
}

export function secretKeyKind(
  secretKey: string | undefined,
): "live" | "test" | null {
  const key = (secretKey ?? "").trim();
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return null;
}

/**
 * A pk_live_ paired with an sk_test_ (or the reverse) can never verify a
 * session token, because the two keys address different Clerk instances.
 */
export function resolveKeyPairing(
  instanceType: "production" | "development" | null,
  kind: "live" | "test" | null,
): KeyPairing {
  if (!instanceType || !kind) return "incomplete";
  const expected = instanceType === "production" ? "live" : "test";
  return kind === expected ? "ok" : "mismatched-environment";
}

/**
 * Static, secret-free view of the Clerk keys this isolate actually resolved.
 */
export function buildClerkKeyReport(req: {
  headers: IncomingHttpHeaders;
}): ClerkKeyReport {
  const envPublishable = (readRuntimeEnv("CLERK_PUBLISHABLE_KEY") || "").trim();
  const envSecret = (readRuntimeEnv("CLERK_SECRET_KEY") || "").trim();
  const resolved = (resolveRuntimePublishableKey(req) || "").trim();
  const requestHost = getClerkProxyHost(req) || null;

  const envKeyValid = isPublishableKey(envPublishable);
  const source: PublishableKeySource = envKeyValid
    ? "env"
    : resolved
      ? "derived-from-host"
      : "none";

  const instanceType = resolved
    ? isProductionFromPublishableKey(resolved)
      ? "production"
      : isDevelopmentFromPublishableKey(resolved)
        ? "development"
        : null
    : null;

  const kind = secretKeyKind(envSecret);
  const secretValid = /^sk_(?:live|test)_/.test(envSecret);
  const keyPairing = resolveKeyPairing(instanceType, kind);

  const notes: string[] = [];
  if (envPublishable && !envKeyValid) {
    notes.push(
      "CLERK_PUBLISHABLE_KEY is set but is not a valid publishable key. " +
        "resolveRuntimePublishableKey() silently derived a key from the request " +
        "host instead, so authenticated routes fail with 401 rather than 503.",
    );
  }
  if (!envPublishable) {
    notes.push("CLERK_PUBLISHABLE_KEY is unset.");
  }
  if (!envSecret) {
    notes.push(
      "CLERK_SECRET_KEY is unset — no session token can be verified.",
    );
  } else if (!secretValid) {
    notes.push(
      "CLERK_SECRET_KEY does not start with sk_live_ or sk_test_.",
    );
  }
  if (keyPairing === "mismatched-environment") {
    notes.push(
      `Publishable key is a ${instanceType} key but the secret key is ${kind}. ` +
        "These address different Clerk instances, so every authenticated " +
        "request 401s even though both secrets are present.",
    );
  }
  if (source === "derived-from-host") {
    notes.push(
      `Publishable key was derived from request host "${requestHost ?? ""}". ` +
        "Set a real CLERK_PUBLISHABLE_KEY so this does not depend on headers.",
    );
  }

  return {
    publishableKey: {
      present: Boolean(envPublishable),
      valid: envKeyValid,
      source,
      instanceType,
      frontendApiHost: decodeClerkFrontendHost(resolved),
      keyTail: keyTail(resolved),
    },
    secretKey: {
      present: Boolean(envSecret),
      valid: secretValid,
      kind,
      keyTail: keyTail(envSecret),
    },
    keyPairing,
    requestHost,
    notes,
  };
}

function probeSignal(): AbortSignal | undefined {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(PROBE_TIMEOUT_MS);
  }
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Extracts `kid`s from a JWKS body. Never returns key material. */
function kidsFromJwks(body: unknown): string[] {
  const keys = (body as { keys?: unknown })?.keys;
  if (!Array.isArray(keys)) return [];
  return keys
    .map((key) => (key as { kid?: unknown })?.kid)
    .filter((kid): kid is string => typeof kid === "string" && kid.length > 0)
    .sort();
}

async function fetchJwks(
  url: string,
  secretKey: string | undefined,
  fetchImpl: typeof fetch,
): Promise<JwksProbe> {
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      headers: secretKey
        ? { Authorization: `Bearer ${secretKey}`, accept: "application/json" }
        : { accept: "application/json" },
      signal: probeSignal(),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, url, kids: [] };
    }
    const body = (await response.json()) as unknown;
    const kids = kidsFromJwks(body);
    return { ok: kids.length > 0, status: response.status, url, kids };
  } catch (err) {
    return {
      ok: false,
      status: null,
      url,
      kids: [],
      error: errorMessage(err),
    };
  }
}

function hostFromUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/**
 * `GET /v1/domains` returns the instance's primary domain plus satellites,
 * each with the Frontend API URL Clerk actually serves. Comparing that host to
 * the publishable key's decoded host names the mismatch in plain English.
 */
async function fetchInstanceDomains(
  secretKey: string,
  fetchImpl: typeof fetch,
): Promise<DomainsProbe> {
  try {
    const response = await fetchImpl(`${CLERK_BACKEND_API}/v1/domains`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        accept: "application/json",
      },
      signal: probeSignal(),
    });
    if (!response.ok) {
      return { ok: false, status: response.status, primaryFrontendApiHost: null };
    }
    const body = (await response.json()) as {
      data?: Array<Record<string, unknown>>;
    };
    const domains = Array.isArray(body?.data) ? body.data : [];
    const primary =
      domains.find((domain) => domain.is_satellite === false) ?? domains[0];
    return {
      ok: true,
      status: response.status,
      primaryFrontendApiHost:
        hostFromUrl(primary?.frontend_api_url) ??
        (typeof primary?.name === "string" ? primary.name : null),
    };
  } catch (err) {
    return {
      ok: false,
      status: null,
      primaryFrontendApiHost: null,
      error: errorMessage(err),
    };
  }
}

/**
 * Live probe. Proves instance identity by intersecting JWKS `kid` sets:
 * the Backend API set is derived from CLERK_SECRET_KEY, the Frontend API set
 * from CLERK_PUBLISHABLE_KEY. Disjoint sets mean the keys are from different
 * Clerk instances, which is exactly the silent 401 case.
 */
export async function probeClerkInstance(
  report: ClerkKeyReport,
  secretKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<ClerkProbeReport> {
  const frontendHost = report.publishableKey.frontendApiHost;
  const frontendUrl = frontendHost
    ? `https://${frontendHost}/.well-known/jwks.json`
    : "";

  const [frontendApiJwks, backendApiJwks, instanceDomains] = await Promise.all([
    frontendUrl
      ? fetchJwks(frontendUrl, undefined, fetchImpl)
      : Promise.resolve<JwksProbe>({
          ok: false,
          status: null,
          url: "",
          kids: [],
          error: "No Frontend API host could be decoded from the publishable key.",
        }),
    secretKey
      ? fetchJwks(`${CLERK_BACKEND_API}/v1/jwks`, secretKey, fetchImpl)
      : Promise.resolve<JwksProbe>({
          ok: false,
          status: null,
          url: `${CLERK_BACKEND_API}/v1/jwks`,
          kids: [],
          error: "CLERK_SECRET_KEY is unset.",
        }),
    secretKey
      ? fetchInstanceDomains(secretKey, fetchImpl)
      : Promise.resolve<DomainsProbe>({
          ok: false,
          status: null,
          primaryFrontendApiHost: null,
          error: "CLERK_SECRET_KEY is unset.",
        }),
  ]);

  const sharedKids = frontendApiJwks.kids.filter((kid) =>
    backendApiJwks.kids.includes(kid),
  );

  const instanceMatch =
    frontendApiJwks.ok && backendApiJwks.ok ? sharedKids.length > 0 : null;

  return {
    frontendApiJwks,
    backendApiJwks,
    instanceDomains,
    instanceMatch,
    sharedKids,
  };
}

/** HTTP status for the combined report: 200 healthy, 503 when auth cannot work. */
export function clerkDiagnosticStatus(
  report: ClerkKeyReport,
  probe?: ClerkProbeReport,
): { status: "ok" | "warn" | "error"; httpStatus: number } {
  const brokenKeys =
    !report.publishableKey.valid ||
    !report.secretKey.valid ||
    report.keyPairing === "mismatched-environment";

  // A 401/403 from the Backend API means the secret key itself is rejected:
  // the key is invalid, revoked, or belongs to a deleted instance. That is a
  // hard failure even though every presence check passes, so it must not be
  // reported as "ok".
  const secretKeyRejected =
    probe?.backendApiJwks.status === 401 || probe?.backendApiJwks.status === 403;

  if (brokenKeys || probe?.instanceMatch === false || secretKeyRejected) {
    return { status: "error", httpStatus: 503 };
  }
  if (report.publishableKey.source === "derived-from-host") {
    return { status: "warn", httpStatus: 200 };
  }
  // Probe requested but instance identity could not be confirmed (network
  // failure, unexpected status) — report a warning rather than a false "ok".
  if (probe && probe.instanceMatch !== true) {
    return { status: "warn", httpStatus: 200 };
  }
  return { status: "ok", httpStatus: 200 };
}

/** Operator-facing summary of what the probe proved. */
export function summarizeClerkProbe(
  report: ClerkKeyReport,
  probe: ClerkProbeReport,
): string {
  if (probe.instanceMatch === true) {
    return "CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY belong to the same Clerk instance.";
  }
  if (probe.instanceMatch === false) {
    const expected = report.publishableKey.frontendApiHost ?? "the publishable key's host";
    const actual = probe.instanceDomains.primaryFrontendApiHost ?? "a different instance";
    return (
      "Key mismatch: CLERK_SECRET_KEY belongs to an instance whose Frontend API " +
      `is ${actual}, but CLERK_PUBLISHABLE_KEY points at ${expected}. ` +
      "Session tokens minted for the browser cannot be verified, so every " +
      "authenticated route returns 401. Copy both keys from the same Clerk " +
      "instance and redeploy."
    );
  }
  if (probe.backendApiJwks.status === 401) {
    return "CLERK_SECRET_KEY was rejected by the Clerk Backend API (401). The key is invalid or revoked.";
  }
  return "Instance identity could not be confirmed — see the probe fields for which call failed.";
}
