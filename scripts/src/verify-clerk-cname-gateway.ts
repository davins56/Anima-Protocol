/**
 * Live probe: clerk.anima-protocol.com must be the Worker gateway, not
 * Clerk's grey-cloud CNAME.
 *
 * Both `/v1/oauth_callback` (303 to apex sign-in) and `/v1/environment`
 * (200 Clerk JSON) must succeed. A callback-only pass can hide a broken
 * gateway origin for clerk-js.
 *
 *   pnpm --filter @workspace/scripts run verify:clerk-cname-gateway
 */

const CLERK_CNAME_ORIGIN = "https://clerk.anima-protocol.com";
const CLERK_SERVICES_CNAME = "frontend-api.clerk.services";

export type ClerkCnameHttpProbe = {
  status: number;
  location: string | null;
  bodySnippet: string;
};

export type ClerkCnameGatewayProbe = {
  oauthCallback: ClerkCnameHttpProbe;
  environment: ClerkCnameHttpProbe;
  cnameTarget: string | null;
};

export function isClerkEnvironmentPayload(bodySnippet: string): boolean {
  const text = (bodySnippet || "").trim();
  if (!text || text.startsWith("<")) return false;
  if (/"auth_config"\s*:/.test(text) || /"display_config"\s*:/.test(text)) {
    return true;
  }
  try {
    const parsed = JSON.parse(text) as {
      auth_config?: unknown;
      display_config?: unknown;
    };
    return Boolean(parsed.auth_config || parsed.display_config);
  } catch {
    return false;
  }
}

function interpretOauthCallback(
  probe: ClerkCnameHttpProbe,
): { ok: boolean; reason: string } {
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

function interpretEnvironment(
  probe: ClerkCnameHttpProbe,
): { ok: boolean; reason: string } {
  if (probe.status !== 200) {
    return {
      ok: false,
      reason:
        `GET /v1/environment returned ${probe.status}` +
        (probe.location ? ` Location=${probe.location}` : "") +
        " — clerk-js cannot load the instance.",
    };
  }
  if (!isClerkEnvironmentPayload(probe.bodySnippet)) {
    return {
      ok: false,
      reason:
        "GET /v1/environment is not Clerk environment JSON (need auth_config or display_config).",
    };
  }
  return { ok: true, reason: "environment 200 Clerk JSON" };
}

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

  const oauth = interpretOauthCallback(probe.oauthCallback);
  if (!oauth.ok) return oauth;

  const environment = interpretEnvironment(probe.environment);
  if (!environment.ok) return environment;

  return {
    ok: true,
    reason: `${oauth.reason} and ${environment.reason}`,
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

async function fetchProbe(path: string): Promise<ClerkCnameHttpProbe> {
  const response = await fetch(`${CLERK_CNAME_ORIGIN}${path}`, {
    method: "GET",
    redirect: "manual",
    headers: { "user-agent": "anima-verify-clerk-cname-gateway" },
  });
  const bodySnippet = (await response.text()).slice(0, 2048);
  return {
    status: response.status,
    location: response.headers.get("location"),
    bodySnippet,
  };
}

async function main() {
  const host = "clerk.anima-protocol.com";
  const cnameTarget = await lookupCname(host);
  const [oauthCallback, environment] = await Promise.all([
    fetchProbe("/v1/oauth_callback"),
    fetchProbe("/v1/environment"),
  ]);
  const result = interpretClerkCnameGatewayProbe({
    oauthCallback,
    environment,
    cnameTarget,
  });
  console.log(
    JSON.stringify(
      {
        ok: result.ok,
        reason: result.reason,
        oauthCallback: {
          status: oauthCallback.status,
          location: oauthCallback.location,
        },
        environment: {
          status: environment.status,
          location: environment.location,
          clerkJson: isClerkEnvironmentPayload(environment.bodySnippet),
        },
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
