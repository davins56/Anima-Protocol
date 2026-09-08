/**
 * Live probe: clerk.anima-protocol.com must be the Worker gateway, not
 * Clerk's grey-cloud CNAME.
 *
 *   pnpm --filter @workspace/scripts run verify:clerk-cname-gateway
 */

const CLERK_CNAME_ORIGIN = "https://clerk.anima-protocol.com";
const CLERK_SERVICES_CNAME = "frontend-api.clerk.services";

export type ClerkCnameGatewayProbe = {
  status: number;
  location: string | null;
  bodySnippet: string;
  cnameTarget: string | null;
};

export function interpretClerkCnameGatewayProbe(
  probe: ClerkCnameGatewayProbe,
): { ok: boolean; reason: string } {
  const cname = (probe.cnameTarget || "").toLowerCase().replace(/\.$/, "");
  if (cname === CLERK_SERVICES_CNAME || cname.endsWith(".clerk.services")) {
    return {
      ok: false,
      reason:
        `DNS still CNAMEs to ${cname || CLERK_SERVICES_CNAME}. ` +
        `Delete that record, then wrangler custom_domain can attach ` +
        `clerk.anima-protocol.com to Worker anima-protocol. ` +
        `See scripts/cloudflare/clerk-cname-gateway.md.`,
    };
  }
  if (probe.status === 301 && /err_code=authorization_invalid/i.test(probe.location || "")) {
    return {
      ok: false,
      reason:
        "GET /v1/oauth_callback still 301s Clerk err_code — the gateway is not the origin.",
    };
  }
  if (probe.status === 403 && /authorization_invalid/.test(probe.bodySnippet)) {
    return {
      ok: false,
      reason: "GET /v1/oauth_callback still returns Clerk 403 JSON.",
    };
  }
  if (
    probe.status === 303 &&
    /\/sign-in\?clerk_error=authorization_invalid/.test(probe.location || "")
  ) {
    return { ok: true, reason: "gateway 303 to /sign-in?clerk_error=" };
  }
  return {
    ok: false,
    reason: `Unexpected oauth_callback ${probe.status} Location=${probe.location || ""}`,
  };
}

async function lookupCname(host: string): Promise<string | null> {
  try {
    const { resolveCname } = await import("node:dns/promises");
    const records = await resolveCname(host);
    return records[0] || null;
  } catch {
    return null;
  }
}

async function main() {
  const host = "clerk.anima-protocol.com";
  const cnameTarget = await lookupCname(host);
  const response = await fetch(`${CLERK_CNAME_ORIGIN}/v1/oauth_callback`, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": "anima-verify-clerk-cname-gateway" },
  });
  const location = response.headers.get("location");
  const bodySnippet = await response.text();
  const result = interpretClerkCnameGatewayProbe({
    status: response.status,
    location,
    bodySnippet: bodySnippet.slice(0, 240),
    cnameTarget,
  });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        reason: result.reason,
        status: response.status,
        location,
        cnameTarget,
      },
      null,
      2,
    ),
  );
  if (!result.ok) process.exit(1);
}

const invokedDirectly =
  typeof process !== "undefined" &&
  process.argv[1] &&
  /verify-clerk-cname-gateway/.test(process.argv[1]);

if (invokedDirectly) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
