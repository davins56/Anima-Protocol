import { logger } from "./logger";

const SIGN_IN_CALLBACK = "/sign-in/sso-callback";
const SIGN_UP_CALLBACK = "/sign-up/sso-callback";

function previewOriginFromEnv(): string | null {
  const raw =
    process.env.VERCEL_URL?.trim() ||
    process.env.VERCEL_BRANCH_URL?.trim() ||
    "";
  if (!raw) return null;
  const host = raw.replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (!host.endsWith(".vercel.app")) return null;
  return `https://${host}`;
}

function callbackUrls(origin: string): string[] {
  return [`${origin}${SIGN_IN_CALLBACK}`, `${origin}${SIGN_UP_CALLBACK}`];
}

async function listRedirectUrls(secretKey: string): Promise<Set<string>> {
  const response = await fetch("https://api.clerk.com/v1/redirect_urls", {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!response.ok) {
    throw new Error(`Clerk redirect_urls list failed (${response.status})`);
  }
  const body = (await response.json()) as
    | Array<{ url?: string }>
    | { data?: Array<{ url?: string }> };
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  return new Set(
    rows.map((entry) => entry.url).filter((url): url is string => Boolean(url)),
  );
}

async function addRedirectUrl(
  secretKey: string,
  url: string,
): Promise<"added" | "exists"> {
  const response = await fetch("https://api.clerk.com/v1/redirect_urls", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ url }),
  });
  if (response.ok) return "added";
  const text = await response.text();
  if (response.status === 422 && text.includes("already exists")) {
    return "exists";
  }
  throw new Error(`Clerk redirect_urls create failed (${response.status}): ${text}`);
}

/**
 * Vercel preview hosts change on every deployment. Clerk does not support
 * wildcard redirect URLs, so register this deployment's callbacks on cold start.
 */
export async function ensureClerkPreviewRedirects(): Promise<void> {
  const secretKey = process.env.CLERK_SECRET_KEY?.trim();
  const origin = previewOriginFromEnv();
  if (!secretKey?.startsWith("sk_") || !origin) {
    return;
  }

  try {
    const existing = await listRedirectUrls(secretKey);
    const missing = callbackUrls(origin).filter((url) => !existing.has(url));
    if (missing.length === 0) {
      logger.info({ origin }, "Clerk preview redirect URLs already registered");
      return;
    }

    for (const url of missing) {
      const result = await addRedirectUrl(secretKey, url);
      logger.info({ url, result }, "Registered Clerk preview redirect URL");
    }
  } catch (err) {
    logger.warn({ err, origin }, "Could not auto-register Clerk preview redirect URLs");
  }
}

void ensureClerkPreviewRedirects();
