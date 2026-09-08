import { ANIMA_APEX_HOST } from "../middlewares/clerkProxyHosts";

/**
 * Clerk's custom-domain CNAME target (Cloudflare for SaaS).
 *
 * Live DNS (before #421): clerk.anima-protocol.com → frontend-api.clerk.services →
 * worker.clerkprod-cloudflare.net. Orange-clouding that CNAME on our zone
 * is Error 1014 (CNAME Cross-User Banned).
 *
 * After clerk.anima-protocol.com is a Worker Custom Domain, a subrequest
 * whose URL host is still clerk.{apex} is a fetch to this isolate.
 * Cloudflare documents that as HTTP 522. `cf.resolveOverride` cannot
 * escape that: it is ignored unless BOTH the URL host and the override
 * host are orange-clouded on this zone. `worker.clerkprod-cloudflare.net`
 * is Clerk's zone, so the override never applies. Connecting to Clerk's
 * anycast IPs with SNI clerk.{apex} also lands on this Custom Domain.
 *
 * Upstream must therefore change the URL host (and SNI) to Clerk's owned
 * FAPI (`frontend-api.clerk.dev`). Do not set Host clerk.{apex} on that
 * hop — Cloudflare on Clerk's zone 403s Host/SNI mismatch, and
 * frontend-api.clerk.services has no public certificate for its own name.
 * Identify the instance with the official path-proxy headers
 * (Clerk-Proxy-Url + Clerk-Secret-Key + X-Forwarded-For), not Host.
 *
 * `CLERK_CNAME_RESOLVE_OVERRIDE` is kept as a documented dead-end so tests
 * and ops notes can assert we no longer send it.
 */
export const CLERK_CNAME_RESOLVE_OVERRIDE = "worker.clerkprod-cloudflare.net";

/** Clerk-owned Frontend API. TLS works; CNAME-only instances need proxy headers. */
export const CLERK_OWNED_FAPI_ORIGIN = "https://frontend-api.clerk.dev";

export const CLERK_CNAME_HOST = `clerk.${ANIMA_APEX_HOST}`;

export function isClerkCnameRequestHost(
  hostname: string | null | undefined,
): boolean {
  return (
    String(hostname || "")
      .toLowerCase()
      .replace(/:\d+$/, "") === CLERK_CNAME_HOST
  );
}

export function isClerkOwnedFapiHost(
  hostname: string | null | undefined,
): boolean {
  return (
    String(hostname || "")
      .toLowerCase()
      .replace(/:\d+$/, "") === new URL(CLERK_OWNED_FAPI_ORIGIN).hostname
  );
}

/**
 * Rewrite Worker→Clerk fetches off our Custom Domain so the isolate does
 * not 522 on itself. Paths and query stay intact.
 */
export function clerkCnameUpstreamUrl(url: URL | string): URL {
  const parsed =
    typeof url === "string"
      ? new URL(url, "https://anima-protocol.com")
      : new URL(url.href);
  if (!isClerkCnameRequestHost(parsed.hostname)) return parsed;
  return new URL(
    `${parsed.pathname}${parsed.search}${parsed.hash}`,
    CLERK_OWNED_FAPI_ORIGIN,
  );
}

type FetchInitWithCf = RequestInit & { cf?: Record<string, unknown> };

/**
 * Fetch init for Worker→Clerk. Never sets `cf.resolveOverride` — that
 * option is ignored for Clerk's hostname and the leftover self-fetch is
 * the production 522.
 */
export function clerkFrontendFetchInit(
  _upstream: URL | string,
  init: FetchInitWithCf = {},
): FetchInitWithCf {
  const next: FetchInitWithCf = {
    ...init,
    redirect: init.redirect ?? "manual",
  };
  if (next.cf && "resolveOverride" in next.cf) {
    const { resolveOverride: _dropped, ...rest } = next.cf;
    next.cf = rest;
    if (Object.keys(next.cf).length === 0) delete next.cf;
  }
  return next;
}

/**
 * Drop Host / :authority copied from clerk.{apex} so the rewritten
 * frontend-api.clerk.dev hop is not Cloudflare-403'd.
 */
export function stripClerkCnameHostHeader(headers: Headers): Headers {
  headers.delete("host");
  return headers;
}
