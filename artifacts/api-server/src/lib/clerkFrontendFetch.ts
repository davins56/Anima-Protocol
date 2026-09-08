import { ANIMA_APEX_HOST } from "../middlewares/clerkProxyHosts";

/**
 * Clerk's custom-domain CNAME target (Cloudflare for SaaS).
 *
 * Live DNS: clerk.anima-protocol.com → frontend-api.clerk.services →
 * worker.clerkprod-cloudflare.net. Orange-clouding that CNAME on our zone
 * is Error 1014 (CNAME Cross-User Banned). A Worker route on
 * clerk.anima-protocol.com must therefore fetch Clerk with
 * `cf.resolveOverride` so we do not loop back into this isolate after
 * DNS points at us, and so Safari no longer sees a third-party CNAME
 * (ITP CNAME-cloaking hides Domain=apex `__client` on iPad).
 */
export const CLERK_CNAME_RESOLVE_OVERRIDE = "worker.clerkprod-cloudflare.net";

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

/**
 * Workers `fetch` init that keeps Host/SNI as clerk.{apex} while resolving
 * to Clerk's origin. Harmless in Node tests (mocked fetch ignores `cf`).
 * Only apply when the URL host is the production CNAME — pk_test_ /
 * accounts.dev / frontend-api.clerk.dev must use normal DNS.
 */
type FetchInitWithCf = RequestInit & { cf?: Record<string, unknown> };

export function withClerkCnameResolveOverride(
  init: FetchInitWithCf = {},
): FetchInitWithCf {
  const previous = init.cf && typeof init.cf === "object" ? init.cf : {};
  return {
    ...init,
    redirect: init.redirect ?? "manual",
    cf: {
      ...previous,
      resolveOverride: CLERK_CNAME_RESOLVE_OVERRIDE,
    },
  };
}

export function clerkFrontendFetchInit(
  upstream: URL | string,
  init: FetchInitWithCf = {},
): FetchInitWithCf {
  const url =
    typeof upstream === "string"
      ? new URL(upstream, "https://anima-protocol.com")
      : upstream;
  if (!isClerkCnameRequestHost(url.hostname)) {
    return {
      ...init,
      redirect: init.redirect ?? "manual",
    };
  }
  return withClerkCnameResolveOverride(init);
}
