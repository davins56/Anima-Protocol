/**
 * Verify Clerk OAuth providers and redirect URLs for Anima Protocol sign-in.
 *
 * Usage (from repo root with .env loaded):
 *   pnpm --filter @workspace/scripts run verify:clerk-oauth
 *   pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
 *
 * Clerk-side “enabled” is not enough for Production. Google/Apple/GitHub apps
 * must allowlist the Clerk Frontend API callback
 * (`https://clerk…/v1/oauth_callback`). Google `redirect_uri_mismatch` and
 * Apple `invalid_request` with an empty `client_id` are provider-console issues.
 */

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY?.trim();
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY?.trim();

const REQUIRED_STRATEGIES = [
  "oauth_google",
  "oauth_github",
  "oauth_apple",
] as const;

const DEFAULT_REDIRECT_URLS = [
  "https://www.anima-protocol.com/sign-in/sso-callback",
  "https://www.anima-protocol.com/sign-up/sso-callback",
  "https://anima-protocol.com/sign-in/sso-callback",
  "https://anima-protocol.com/sign-up/sso-callback",
  "http://localhost:23660/sign-in/sso-callback",
  "http://localhost:23660/sign-up/sso-callback",
  "http://localhost:4173/sign-in/sso-callback",
  "http://localhost:4173/sign-up/sso-callback",
];

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function previewHostsFromArgs(): string[] {
  const hosts: string[] = [];
  const argv = process.argv;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--preview-host" && argv[i + 1]) {
      hosts.push(argv[i + 1].trim());
      i += 1;
      continue;
    }
    if (argv[i]?.startsWith("--preview-host=")) {
      hosts.push(argv[i].slice("--preview-host=".length).trim());
    }
  }
  const vercelUrl = process.env.VERCEL_URL?.trim();
  if (vercelUrl) {
    hosts.push(vercelUrl.replace(/^https?:\/\//, ""));
  }
  return [...new Set(hosts.filter(Boolean))];
}

function redirectUrlsForHost(host: string): string[] {
  const normalized = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const origin = normalized.startsWith("http")
    ? normalized
    : `https://${normalized}`;
  return [
    `${origin}/sign-in/sso-callback`,
    `${origin}/sign-up/sso-callback`,
  ];
}

function decodeFrontendHost(publishableKey: string): string | null {
  const match = publishableKey.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    return decoded.replace(/\$$/, "") || null;
  } catch {
    return null;
  }
}

function decodeInstanceSlug(publishableKey: string): string | null {
  const host = decodeFrontendHost(publishableKey);
  if (!host) return null;
  if (host.endsWith(".clerk.accounts.dev")) {
    return host.split(".")[0] ?? null;
  }
  return host;
}

function environmentUrl(publishableKey: string): string {
  const host = decodeFrontendHost(publishableKey);
  if (!host) {
    throw new Error("Could not decode Clerk publishable key");
  }
  if (host.endsWith(".clerk.accounts.dev")) {
    const slug = host.split(".")[0];
    return `https://${slug}.clerk.accounts.dev/v1/environment`;
  }
  return `https://${host}/v1/environment`;
}

async function clerkFetch(path: string, init?: RequestInit): Promise<Response> {
  if (!CLERK_SECRET_KEY) {
    throw new Error("CLERK_SECRET_KEY is required");
  }
  return fetch(`https://api.clerk.com/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

async function fetchEnvironment(publishableKey: string) {
  const response = await fetch(environmentUrl(publishableKey));
  if (!response.ok) {
    throw new Error(`Failed to fetch Clerk environment (${response.status})`);
  }
  return response.json() as Promise<{
    auth_config?: {
      identification_strategies?: string[];
      first_factors?: string[];
    };
    display_config?: {
      google_one_tap_client_id?: string | null;
      instance_environment_type?: string;
    };
    user_settings?: {
      social?: Record<
        string,
        {
          enabled?: boolean;
          authenticatable?: boolean;
          name?: string;
        }
      >;
    };
  }>;
}

function printProviderConsoleChecklist(options: {
  publishableKey: string;
  providerCallback: string | null;
  googleClientId: string | null;
  isProduction: boolean;
}): void {
  const { providerCallback, googleClientId, isProduction } = options;
  if (!providerCallback) return;

  console.log("\nProvider console checklist (required for social login):");
  console.log(`  Authorized redirect / callback URI:`);
  console.log(`    ${providerCallback}`);
  if (googleClientId) {
    console.log(`  Google OAuth client ID (from Clerk):`);
    console.log(`    ${googleClientId}`);
    console.log(
      "  Google Cloud Console → APIs & Services → Credentials → that OAuth client",
    );
    console.log(`    → Authorized redirect URIs → add exactly:`);
    console.log(`      ${providerCallback}`);
    console.log(
      "    → Authorized JavaScript origins: https://www.anima-protocol.com",
    );
    console.log(
      "    (Error 400 redirect_uri_mismatch means this URI is missing.)",
    );
  } else if (isProduction) {
    console.log(
      "  Google: open Clerk → Production → SSO → Google and copy Client ID,",
    );
    console.log(
      `    then allowlist ${providerCallback} on that Google OAuth client.`,
    );
  }
  console.log(
    `  GitHub OAuth App → Authorization callback URL: ${providerCallback}`,
  );
  console.log(
    `  Apple Return URL (Services ID): ${providerCallback}`,
  );
  if (isProduction) {
    console.log(
      "  Apple: Production requires a real Services ID / client ID in Clerk.",
    );
    console.log(
      "    Empty client_id on appleid.apple.com → invalid_request means",
    );
    console.log(
      "    Apple SSO is enabled in Clerk but custom credentials are missing.",
    );
  }
}

async function listRedirectUrls(): Promise<string[]> {
  const response = await clerkFetch("/redirect_urls");
  if (!response.ok) {
    throw new Error(`Failed to list redirect URLs (${response.status})`);
  }
  const body = (await response.json()) as
    | Array<{ url?: string }>
    | { data?: Array<{ url?: string }> };
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return rows.map((entry) => entry.url).filter(Boolean) as string[];
}

async function addRedirectUrl(url: string): Promise<"added" | "exists"> {
  const response = await clerkFetch("/redirect_urls", {
    method: "POST",
    body: JSON.stringify({ url }),
  });
  if (response.ok) return "added";
  const text = await response.text();
  if (response.status === 422 && text.includes("already exists")) {
    return "exists";
  }
  throw new Error(`Failed to add redirect URL ${url} (${response.status}): ${text}`);
}

function instanceLabel(publishableKey: string | undefined): string {
  if (!publishableKey) return "unknown";
  return publishableKey.startsWith("pk_test_") ? "Development" : "Production";
}

function assertClerkKeyPair(): void {
  if (!CLERK_SECRET_KEY) {
    throw new Error("Set CLERK_SECRET_KEY in .env or the environment");
  }
  if (CLERK_SECRET_KEY.startsWith("pk_")) {
    throw new Error(
      "CLERK_SECRET_KEY is set to a publishable pk_* key. Replace it with the matching Clerk secret key (sk_live_* for Production, sk_test_* for Development).",
    );
  }
  if (!CLERK_SECRET_KEY.startsWith("sk_")) {
    throw new Error("CLERK_SECRET_KEY must start with sk_");
  }
  if (!CLERK_PUBLISHABLE_KEY) {
    throw new Error(
      "Set CLERK_PUBLISHABLE_KEY (pk_test_ or pk_live_) in .env to inspect OAuth strategies",
    );
  }
  if (!CLERK_PUBLISHABLE_KEY.startsWith("pk_")) {
    throw new Error("CLERK_PUBLISHABLE_KEY must start with pk_");
  }
  const secretEnv = CLERK_SECRET_KEY.startsWith("sk_live_") ? "live" : "test";
  const publicEnv = CLERK_PUBLISHABLE_KEY.startsWith("pk_live_")
    ? "live"
    : "test";
  if (secretEnv !== publicEnv) {
    throw new Error(
      `Clerk key mismatch: CLERK_SECRET_KEY is ${secretEnv}, but CLERK_PUBLISHABLE_KEY is ${publicEnv}. Use keys from the same Clerk instance.`,
    );
  }
}

function providerOAuthCallbackUrl(publishableKey: string | undefined): string | null {
  const host = publishableKey ? decodeFrontendHost(publishableKey) : null;
  if (!host) return null;
  return `https://${host}/v1/oauth_callback`;
}

function dashboardHint(publishableKey: string | undefined): string {
  const label = instanceLabel(publishableKey);
  const slug = publishableKey ? decodeInstanceSlug(publishableKey) : null;
  const slugNote = slug ? ` (instance: ${slug})` : "";
  const providerCallback = providerOAuthCallbackUrl(publishableKey);
  return [
    `Clerk Dashboard → ${label}${slugNote} → Configure → SSO connections`,
    "→ Add connection → For all users → Google and GitHub",
    label === "Development"
      ? "→ Leave “Use custom credentials” OFF (shared dev OAuth)"
      : "→ Enable sign-up/sign-in + add your Google and GitHub OAuth app credentials",
    providerCallback
      ? `→ Google/GitHub/Apple OAuth apps must allowlist ${providerCallback}`
      : "→ Copy Clerk’s Authorized Redirect URI into Google/GitHub/Apple OAuth apps",
    "→ Paths → Redirect URLs: include www.anima-protocol.com/sign-in/sso-callback",
    "→ Redeploy Vercel after any env key changes",
  ].join("\n  ");
}

async function main(): Promise<void> {
  const fixRedirects = hasFlag("--fix-redirects");
  assertClerkKeyPair();

  const publishableKey = CLERK_PUBLISHABLE_KEY!;
  const slug = decodeInstanceSlug(publishableKey);
  if (!slug) {
    throw new Error(
      "Set CLERK_PUBLISHABLE_KEY (pk_test_ or pk_live_) in .env to inspect OAuth strategies",
    );
  }

  console.log(`Clerk instance: ${slug} (${instanceLabel(publishableKey)})`);

  const providerCallback = providerOAuthCallbackUrl(publishableKey);
  if (providerCallback) {
    console.log(`\nProvider OAuth callback (Google/GitHub/Apple apps):`);
    console.log(`  ${providerCallback}`);
    console.log(
      "  (App SSO paths like /sign-in/sso-callback belong in Clerk → Paths, not in provider apps.)",
    );
  }

  const environment = await fetchEnvironment(publishableKey);
  const strategies = environment.auth_config?.identification_strategies ?? [];
  const firstFactors = environment.auth_config?.first_factors ?? [];
  const isProduction = instanceLabel(publishableKey) === "Production";
  const googleClientId =
    environment.display_config?.google_one_tap_client_id?.trim() || null;

  console.log("\nIdentification strategies:", strategies.join(", ") || "(none)");
  console.log("First factors:", firstFactors.join(", ") || "(none)");

  let oauthOk = true;
  for (const strategy of REQUIRED_STRATEGIES) {
    const enabled =
      strategies.includes(strategy) || firstFactors.includes(strategy);
    console.log(
      enabled ? `✓ ${strategy} is enabled in Clerk` : `✗ ${strategy} is NOT enabled in Clerk`,
    );
    if (!enabled) oauthOk = false;
  }

  printProviderConsoleChecklist({
    publishableKey,
    providerCallback,
    googleClientId,
    isProduction,
  });

  const existingRedirects = await listRedirectUrls();
  console.log("\nApp redirect URLs registered in Clerk (Paths):", existingRedirects.length);
  for (const url of existingRedirects.sort()) {
    console.log(`  • ${url}`);
  }

  const previewRedirectUrls = previewHostsFromArgs().flatMap(redirectUrlsForHost);
  const requiredRedirects = [...DEFAULT_REDIRECT_URLS, ...previewRedirectUrls];

  const missingRedirects = requiredRedirects.filter(
    (url) => !existingRedirects.includes(url),
  );

  if (missingRedirects.length > 0) {
    console.log("\nMissing app redirect URLs:");
    for (const url of missingRedirects) {
      console.log(`  • ${url}`);
    }
    if (fixRedirects) {
      console.log("\nAdding missing redirect URLs…");
      for (const url of missingRedirects) {
        const result = await addRedirectUrl(url);
        console.log(result === "added" ? `  + ${url}` : `  = ${url} (already registered)`);
      }
    }
  } else {
    console.log("\n✓ All default app redirect URLs are registered in Clerk");
  }

  if (!oauthOk) {
    console.log("\nSocial sign-in will fail until you enable providers in Clerk:\n");
    console.log(`  ${dashboardHint(CLERK_PUBLISHABLE_KEY)}`);
    console.log(
      "\nNote: Creating the repo on GitHub or signing into Clerk with GitHub",
    );
    console.log(
      "does not automatically enable GitHub for your app's end users.",
    );
    process.exitCode = 1;
    return;
  }

  console.log(
    "\n✓ Clerk has Google, GitHub, and Apple enabled for this instance.",
  );
  if (isProduction && providerCallback) {
    console.log(
      "⚠ Production still needs provider consoles to allowlist the callback above.",
    );
    console.log(
      "  Manual check: open www.anima-protocol.com/sign-in and try each button.",
    );
    console.log(
      "  Google Error 400 redirect_uri_mismatch → fix Google Cloud redirect URI.",
    );
    console.log(
      "  Apple invalid_request with empty client_id → set Apple credentials in Clerk.",
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
