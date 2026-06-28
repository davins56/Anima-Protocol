import {
  isDevelopmentFromPublishableKey,
  publishableKeyFromHost,
} from "@clerk/shared/keys";
import type { IncomingHttpHeaders } from "http";

export const CLERK_PROXY_PATH = "/api/__clerk";

/** Public hosts that mint Clerk sessions for this product (apex + www). */
export const KNOWN_PUBLIC_HOSTS = new Set([
  "www.anima-protocol.com",
  "anima-protocol.com",
  "anima-protocol.replit.app",
]);

function hostFromUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).host;
  } catch {
    return undefined;
  }
}

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw?.split(",")[0]?.trim() || undefined;
}

function normalizeHostname(host: string | undefined): string {
  return (host ?? "").toLowerCase().replace(/:\d+$/, "");
}

export function isLocalDevHost(hostname: string): boolean {
  if (!hostname) return true;
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.startsWith("127.0.0.1")
  );
}

function isBackendProxyHost(hostname: string): boolean {
  return (
    hostname.endsWith(".replit.app") ||
    hostname.endsWith(".replit.dev") ||
    hostname.endsWith(".repl.co")
  );
}

/** Clerk dashboard Proxy URL uses www; apex must not produce a mismatched header. */
export function canonicalClerkProxyHeaderHost(host: string | undefined): string {
  const normalized = normalizeHostname(host);
  if (
    normalized === "anima-protocol.com" ||
    normalized === "www.anima-protocol.com"
  ) {
    return "www.anima-protocol.com";
  }
  return host?.split(",")[0]?.trim() || "";
}

export function resolveClerkPublishableKey(
  host: string | undefined,
  fallbackKey: string | undefined,
): string {
  const hostname = normalizeHostname(host);
  if (fallbackKey && isDevelopmentFromPublishableKey(fallbackKey)) {
    return fallbackKey;
  }
  if (fallbackKey?.startsWith("pk_live_") && isLocalDevHost(hostname)) {
    return fallbackKey;
  }
  return publishableKeyFromHost(hostname, fallbackKey);
}

export function getClerkProxyHost(req: {
  headers: IncomingHttpHeaders;
}): string | undefined {
  const originHost = hostFromUrl(
    typeof req.headers.origin === "string" ? req.headers.origin : undefined,
  );
  const refererHost = hostFromUrl(
    typeof req.headers.referer === "string" ? req.headers.referer : undefined,
  );

  const forwarded = headerValue(req.headers["x-forwarded-host"]);
  if (forwarded && !isBackendProxyHost(normalizeHostname(forwarded))) {
    return forwarded;
  }
  if (forwarded && !originHost && !refererHost) {
    return forwarded;
  }

  const publicHost = headerValue(req.headers["x-anima-public-host"]);
  if (publicHost) {
    const normalized = normalizeHostname(publicHost);
    if (KNOWN_PUBLIC_HOSTS.has(normalized)) {
      return publicHost;
    }
    if (
      normalized === normalizeHostname(originHost) ||
      normalized === normalizeHostname(refererHost)
    ) {
      return publicHost;
    }
  }

  if (originHost) return originHost;
  if (refererHost) return refererHost;
  if (forwarded) return forwarded;

  const hostHeader = headerValue(req.headers.host);
  if (hostHeader && !isBackendProxyHost(normalizeHostname(hostHeader))) {
    return hostHeader;
  }

  return hostHeader;
}

export function getClerkAuthHostCandidates(req: {
  headers: IncomingHttpHeaders;
}): string[] {
  const hosts = new Set<string>();
  const primary = getClerkProxyHost(req);
  if (primary) hosts.add(normalizeHostname(primary));
  for (const known of KNOWN_PUBLIC_HOSTS) hosts.add(known);
  for (const h of [...hosts]) {
    if (h.startsWith("www.")) hosts.add(h.slice(4));
    else if (h.includes(".") && !isLocalDevHost(h)) hosts.add(`www.${h}`);
  }
  return [...hosts].filter(Boolean);
}
