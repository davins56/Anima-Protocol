import { apiUrl } from '@/lib/apiOrigin';
import {
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
  publishableKeyUsesCustomDomain,
  resolveClerkProxyUrl,
} from '@/lib/clerkProxy';

// Match the query shape Clerk JS uses in production (single underscore).
const CLERK_ENVIRONMENT_PROBE_PATH =
  '/v1/environment?_clerk_api_version=2025-11-10&_clerk_js_version=6.12.1';

async function readProxyError(res) {
  try {
    return await res.clone().json();
  } catch {
    return null;
  }
}

function clerkErrorCodes(proxyError) {
  if (!proxyError || !Array.isArray(proxyError.errors)) return [];
  return proxyError.errors
    .map((entry) => entry?.code)
    .filter((code) => typeof code === 'string' && code.length > 0);
}

function clerkErrorDetail(proxyError) {
  const entry = proxyError?.errors?.[0];
  return (
    entry?.long_message ||
    entry?.message ||
    (typeof proxyError?.error === 'string' ? proxyError.error : '') ||
    ''
  );
}

/**
 * Quick health check for the same-origin Clerk proxy. When this returns false,
 * ClerkProvider should skip proxyUrl so email/OAuth can use Clerk's API directly.
 */
export async function isClerkProxyHealthy(clerkPubKey) {
  const proxyUrl = resolveClerkProxyUrl(clerkPubKey);
  if (!proxyUrl) return true;
  const proxyBase =
    proxyUrl.startsWith('/') && typeof window !== 'undefined'
      ? `${window.location.origin}${proxyUrl.replace(/\/$/, '')}`
      : proxyUrl.replace(/\/$/, '');

  try {
    const res = await fetch(`${proxyBase}/v1/environment`, {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Probe API + Clerk frontend connectivity. Returns human-readable hints only
 * for real failures — never a false-positive "SDK did not finish loading"
 * message (that belongs in the UI when ClerkLoading is actually stalled).
 */
export async function probeClerkConnectivity(clerkPubKey) {
  const hints = [];
  const usesCustomDomain = publishableKeyUsesCustomDomain(clerkPubKey);
  const proxyUrl =
    clerkProxyProbeBase(clerkPubKey) ||
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/__clerk`;

  try {
    const healthRes = await fetch(apiUrl('/healthz'), {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    if (!healthRes.ok) {
      hints.push(
        `API health check failed (${healthRes.status}). Set DATABASE_URL and CLERK_SECRET_KEY on Vercel.`,
      );
    }
  } catch {
    hints.push('API is unreachable — /api/healthz did not respond.');
  }

  try {
    const clerkRes = await fetch(`${proxyUrl}${CLERK_ENVIRONMENT_PROBE_PATH}`, {
      credentials: usesCustomDomain ? 'omit' : 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    if (!clerkRes.ok) {
      const proxyError = await readProxyError(clerkRes);
      const codes = clerkErrorCodes(proxyError);
      if (proxyError?.error === 'clerk_proxy_invalid_secret') {
        hints.push(
          'Clerk proxy is misconfigured: Vercel Production CLERK_SECRET_KEY is set to a publishable pk_* key. Replace it with the matching Clerk Production sk_live_* secret key, then redeploy without cache.',
        );
        return hints;
      } else if (codes.includes('host_invalid')) {
        hints.push(
          usesCustomDomain
            ? 'Clerk custom domain host is not recognized. Confirm Vercel Production CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY are the matching Clerk Production pk_live_* key for clerk.anima-protocol.com, and that domain is verified in Clerk → Domains.'
            : 'Clerk proxy host is not recognized, so all sign-in and sign-up links will fail. Confirm Vercel Production CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY are the matching Clerk Production pk_live_* key, Clerk Dashboard Proxy URL is https://www.anima-protocol.com/api/__clerk, then redeploy without cache.',
        );
        return hints;
      } else if (usesCustomDomain && codes.includes('subdomain_not_allowed')) {
        hints.push(
          'Clerk is rejecting www.anima-protocol.com for the custom login domain. In Clerk Dashboard → Domains, add www.anima-protocol.com to the allowed subdomains for clerk.anima-protocol.com, then hard-refresh sign-in.',
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
        const detail = clerkErrorDetail(proxyError).replace(/[.]+$/, '');
        const codeHint = codes.length ? ` Clerk error: ${codes.join(', ')}.` : '';
        hints.push(
          usesCustomDomain
            ? `Clerk custom domain failed (${clerkRes.status}) at ${proxyUrl}${detail ? `: ${detail}` : ''}.${codeHint} Confirm clerk.anima-protocol.com is verified in Clerk → Domains and DNS CNAMEs to frontend-api.clerk.services.`
            : `Clerk proxy failed (${clerkRes.status})${detail ? `: ${detail}` : ''}. Confirm CLERK_SECRET_KEY on Vercel and remove VITE_CLERK_PROXY_URL=none if set.`,
        );
      }
    }
  } catch {
    hints.push(
      usesCustomDomain
        ? `Clerk custom domain unreachable at ${proxyUrl} — check clerk.anima-protocol.com DNS (CNAME → frontend-api.clerk.services).`
        : 'Clerk proxy unreachable at /api/__clerk — the api-server must proxy to Clerk in production.',
    );
  }

  const scriptUrl = clerkJsScriptProbeUrl(clerkPubKey);
  if (scriptUrl) {
    try {
      const scriptRes = await fetch(scriptUrl, {
        method: 'GET',
        credentials: usesCustomDomain ? 'omit' : 'same-origin',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!scriptRes.ok) {
        hints.push(
          usesCustomDomain
            ? `Login script failed to load (${scriptRes.status}) via ${scriptUrl}. Confirm clerk.anima-protocol.com DNS in Clerk → Domains, then hard-refresh.`
            : `Login script failed to load (${scriptRes.status}) via ${scriptUrl}. Fix the Clerk proxy environment values, then redeploy without cache.`,
        );
      }
    } catch {
      hints.push(
        usesCustomDomain
          ? `Clerk JS bundle could not be fetched from ${scriptUrl} — check clerk.anima-protocol.com DNS and hard-refresh.`
          : 'Clerk JS bundle could not be fetched through /api/__clerk — sign-in cannot start until this path returns clerk.browser.js.',
      );
    }
  }

  if (import.meta.env.PROD && !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    hints.push(
      'VITE_CLERK_PUBLISHABLE_KEY was missing at build time — set it on Vercel and redeploy without cache.',
    );
  }

  // Intentionally do NOT push a "healthy but SDK did not finish loading" hint
  // here. That stall message is decided by the UI after ClerkLoading has
  // actually stalled (see ClerkLoginDiagnostics in App.full.jsx).

  return hints;
}

/** Message shown only when Clerk UI is still loading after a stall timeout. */
export const CLERK_STALL_HINT =
  'API and Clerk look reachable, but the Clerk SDK has not finished loading. Disable ad blockers, try another browser, or refresh in a few seconds.';
