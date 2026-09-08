const STATE_CACHE_PREFIX = "https://anima-oauth-state.invalid/";
const STATE_TTL_SECONDS = 15 * 60;

export type ClerkOAuthStateCache = {
  match: (request: Request) => Promise<Response | undefined>;
  put: (request: Request, response: Response) => Promise<void>;
};

function stateRequest(state: string): Request {
  return new Request(`${STATE_CACHE_PREFIX}${encodeURIComponent(state)}`);
}

function defaultCache(): ClerkOAuthStateCache | null {
  try {
    const caches = (globalThis as { caches?: { default?: ClerkOAuthStateCache } })
      .caches;
    return caches?.default ?? null;
  } catch {
    return null;
  }
}

/** `state` query on GitHub's authorize URL — Clerk binds it to `__client`. */
export function extractGitHubOAuthState(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host !== "github.com" && !host.endsWith(".github.com")) return null;
    const state = parsed.searchParams.get("state")?.trim();
    return state || null;
  } catch {
    return null;
  }
}

export function extractGitHubAuthorizeUrlFromSignInPayload(
  payload: unknown,
): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const response =
    root.response && typeof root.response === "object"
      ? (root.response as Record<string, unknown>)
      : root;
  const verification =
    (response.first_factor_verification as Record<string, unknown> | undefined) ||
    (response.firstFactorVerification as Record<string, unknown> | undefined) ||
    null;
  const raw =
    verification?.external_verification_redirect_url ||
    verification?.externalVerificationRedirectURL ||
    verification?.externalVerificationRedirectUrl ||
    null;
  return typeof raw === "string" && raw.includes("github.com") ? raw : null;
}

export function extractClientTokenFromCookieHeader(
  cookieHeader: string | undefined,
): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    if (!trimmed.toLowerCase().startsWith("__client=")) continue;
    if (trimmed.toLowerCase().startsWith("__client_uat")) continue;
    const value = trimmed.slice("__client=".length).trim();
    return value || null;
  }
  return null;
}

export function extractClientTokenFromSetCookies(cookies: string[]): string | null {
  for (const raw of cookies) {
    const pair = raw.split(";", 1)[0]?.trim() || "";
    if (!pair.toLowerCase().startsWith("__client=")) continue;
    if (pair.toLowerCase().startsWith("__client_uat")) continue;
    const value = pair.slice("__client=".length).trim();
    if (value && value !== "deleted") return value;
  }
  return null;
}

export async function rememberGitHubOAuthClientState(
  state: string,
  clientToken: string,
  cache: ClerkOAuthStateCache | null = defaultCache(),
): Promise<boolean> {
  if (!state || !clientToken || !cache) return false;
  try {
    await cache.put(
      stateRequest(state),
      new Response(clientToken, {
        headers: {
          "content-type": "text/plain",
          "cache-control": `max-age=${STATE_TTL_SECONDS}`,
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function recallGitHubOAuthClientState(
  state: string,
  cache: ClerkOAuthStateCache | null = defaultCache(),
): Promise<string | null> {
  if (!state || !cache) return null;
  try {
    const hit = await cache.match(stateRequest(state));
    if (!hit) return null;
    const token = (await hit.text()).trim();
    return token || null;
  } catch {
    return null;
  }
}
