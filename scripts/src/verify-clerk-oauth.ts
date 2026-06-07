/**
 * Verify Clerk OAuth providers and redirect URLs for Anima Protocol sign-in.
 *
 * Usage (from repo root with .env loaded):
 *   pnpm --filter @workspace/scripts run verify:clerk-oauth
 *   pnpm --filter @workspace/scripts run verify:clerk-oauth -- --fix-redirects
 */

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY?.trim();
const CLERK_PUBLISHABLE_KEY = process.env.CLERK_PUBLISHABLE_KEY?.trim();

const REQUIRED_STRATEGIES = ["oauth_github"] as const;

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

function decodeInstanceSlug(publishableKey: string): string | null {
  const match = publishableKey.match(/^pk_(?:test|live)_(.+)$/);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], "base64").toString("utf8");
    const slug = decoded.split(".")[0]?.replace(/\$$/, "");
    return slug || null;
  } catch {
    return null;
  }
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

async function fetchEnvironment(slug: string) {
  const response = await fetch(`https://${slug}.clerk.accounts.dev/v1/environment`);
  if (!response.ok) {
    throw new Error(`Failed to fetch Clerk environment (${response.status})`);
  }
  return response.json() as Promise<{
    auth_config?: {
      identification_strategies?: string[];
      first_factors?: string[];
    };
  }>;
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

function dashboardHint(publishableKey: string | undefined): string {
  const label = instanceLabel(publishableKey);
  const slug = publishableKey ? decodeInstanceSlug(publishableKey) : null;
  const slugNote = slug ? ` (instance: ${slug})` : "";
  return [
    `Clerk Dashboard → ${label}${slugNote} → Configure → SSO connections`,
    "→ Add connection → For all users → GitHub",
    label === "Development"
      ? "→ Leave “Use custom credentials” OFF (shared dev OAuth)"
      : "→ Enable sign-up/sign-in + add your GitHub OAuth app credentials",
    "→ Paths → Redirect URLs: include www.anima-protocol.com/sign-in/sso-callback",
    "→ Redeploy Vercel after any env key changes",
  ].join("\n  ");
}

async function main(): Promise<void> {
  const fixRedirects = hasFlag("--fix-redirects");
  assertClerkKeyPair();

  const slug = CLERK_PUBLISHABLE_KEY
    ? decodeInstanceSlug(CLERK_PUBLISHABLE_KEY)
    : null;
  if (!slug) {
    throw new Error(
      "Set CLERK_PUBLISHABLE_KEY (pk_test_ or pk_live_) in .env to inspect OAuth strategies",
    );
  }

  console.log(`Clerk instance: ${slug} (${instanceLabel(CLERK_PUBLISHABLE_KEY)})`);

  const environment = await fetchEnvironment(slug);
  const strategies = environment.auth_config?.identification_strategies ?? [];
  const firstFactors = environment.auth_config?.first_factors ?? [];

  console.log("\nIdentification strategies:", strategies.join(", ") || "(none)");
  console.log("First factors:", firstFactors.join(", ") || "(none)");

  let oauthOk = true;
  for (const strategy of REQUIRED_STRATEGIES) {
    const enabled =
      strategies.includes(strategy) || firstFactors.includes(strategy);
    console.log(
      enabled ? `✓ ${strategy} is enabled` : `✗ ${strategy} is NOT enabled`,
    );
    if (!enabled) oauthOk = false;
  }

  const existingRedirects = await listRedirectUrls();
  console.log("\nRedirect URLs registered:", existingRedirects.length);
  for (const url of existingRedirects.sort()) {
    console.log(`  • ${url}`);
  }

  const missingRedirects = DEFAULT_REDIRECT_URLS.filter(
    (url) => !existingRedirects.includes(url),
  );

  if (missingRedirects.length > 0) {
    console.log("\nMissing redirect URLs:");
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
    console.log("\n✓ All default redirect URLs are registered");
  }

  if (!oauthOk) {
    console.log("\nGitHub sign-in will fail until you enable it in Clerk:\n");
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

  console.log("\n✓ GitHub OAuth is configured for this Clerk instance");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
