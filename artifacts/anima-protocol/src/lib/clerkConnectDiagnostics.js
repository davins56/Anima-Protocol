import { apiUrl } from '@/lib/apiOrigin';
import {
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
  publishableKeyUsesCustomDomain,
} from '@/lib/clerkProxy';

async function readProxyError(res) {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

/**
 * Quick health check for the same-origin Clerk proxy. When this returns false,
 * ClerkProvider should skip proxyUrl so email/OAuth can use Clerk's API directly.
 */
export async function isClerkProxyHealthy(clerkPubKey) {
  const proxyUrl = clerkProxyProbeBase(clerkPubKey);
  if (!proxyUrl) return true;

  try {
    const res = await fetch(`${proxyUrl}/v1/environment`, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Probe API + Clerk proxy when Clerk JS fails to load. Returns human-readable
 * hints for the sign-in error UI.
 */
export async function probeClerkConnectivity(clerkPubKey) {
  const hints = [];
  const usesCustomDomain = publishableKeyUsesCustomDomain(clerkPubKey);
  const proxyUrl =
    clerkProxyProbeBase(clerkPubKey) ||
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/__clerk`;

  let apiOk = false;
  let proxyOk = false;
  let scriptOk = false;

  try {
    const healthRes = await fetch(apiUrl('/healthz'), {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    apiOk = healthRes.ok;
    if (!healthRes.ok) {
      hints.push(
        `API health check failed (${healthRes.status}). Set DATABASE_URL and CLERK_SECRET_KEY on Vercel.`,
      );
    }
  } catch {
    hints.push('API is unreachable — /api/healthz did not respond.');
  }

  try {
    const clerkRes = await fetch(`${proxyUrl}/v1/environment`, {
      credentials: usesCustomDomain ? 'omit' : 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    proxyOk = clerkRes.ok;
    if (!clerkRes.ok) {
      const proxyError = await readProxyError(clerkRes);
      if (proxyError?.error === 'clerk_proxy_invalid_secret') {
        hints.push(
          'Clerk proxy is misconfigured: Vercel Production CLERK_SECRET_KEY is set to a publishable pk_* key. Replace it with the matching Clerk Production sk_live_* secret key, then redeploy without cache.',
        );
        return hints;
      } else if (
        proxyError?.errors?.some((entry) => entry?.code === 'host_invalid')
      ) {
        hints.push(
          'Clerk proxy host is not recognized, so all sign-in and sign-up links will fail. Confirm Vercel Production CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY are the matching Clerk Production pk_live_* key, Clerk Dashboard Proxy URL is https://www.anima-protocol.com/api/__clerk, then redeploy without cache.',
        );
        return hints;
      } else if (clerkRes.status === 503) {
        hints.push(
          'Login service is unavailable (503). Confirm Vercel Production has the matching CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, and VITE_CLERK_PUBLISHABLE_KEY values, then redeploy without cache.',
        );
      } else if (clerkRes.status === 504 || clerkRes.status === 502) {
        hints.push(
          `Clerk proxy upstream failed (${clerkRes.status}). Redeploy the latest API build — the server now proxies Clerk via fetch on Vercel. Also confirm CLERK_SECRET_KEY is your Production sk_live_ key.`,
        );
      } else {
        hints.push(
          usesCustomDomain
            ? `Clerk custom domain failed (${clerkRes.status}) at ${proxyUrl}. Confirm clerk.anima-protocol.com DNS in Clerk → Domains.`
            : `Clerk proxy failed (${clerkRes.status}). Confirm CLERK_SECRET_KEY on Vercel and remove VITE_CLERK_PROXY_URL=none if set.`,
        );
      }
    }
  } catch {
    hints.push(
      usesCustomDomain
        ? `Clerk custom domain unreachable at ${proxyUrl} — check clerk.anima-protocol.com DNS.`
        : 'Clerk proxy unreachable at /api/__clerk — the api-server must proxy to Clerk in production.',
    );
  }

  const scriptUrl = clerkJsScriptProbeUrl(clerkPubKey);
  if (scriptUrl) {
    try {
      const scriptRes = await fetch(scriptUrl, {
        method: 'GET',
        credentials: usesCustomDomain ? 'omit' : 'same-origin',
        signal: AbortSignal.timeout(8000),
      });
      scriptOk = scriptRes.ok;
      if (!scriptRes.ok) {
        hints.push(
          `Login script failed to load (${scriptRes.status}) via ${scriptUrl}. Fix the Clerk proxy environment values, then redeploy without cache.`,
        );
      }
    } catch {
      hints.push(
        'Clerk JS bundle could not be fetched through /api/__clerk — sign-in cannot start until this path returns clerk.browser.js.',
      );
    }
  }

  if (import.meta.env.PROD && !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    hints.push(
      'VITE_CLERK_PUBLISHABLE_KEY was missing at build time — set it on Vercel and redeploy without cache.',
    );
  }

  if (apiOk && proxyOk && scriptOk && hints.length === 0) {
    hints.push(
      'API and Clerk proxy look healthy, but the Clerk SDK did not finish loading. Disable ad blockers, try another browser, or refresh in a few seconds.',
    );
  }

  return hints;
}
