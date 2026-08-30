import { apiUrl } from '@/lib/apiOrigin';
import {
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
  resolveClerkProxyUrl,
} from '@/lib/clerkProxy';

// Match Clerk JS: API version uses double underscore; JS version uses single.
const CLERK_ENVIRONMENT_PROBE_PATH =
  '/v1/environment?__clerk_api_version=2025-11-10&_clerk_js_version=6.12.1';

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

  const isProxy = proxyUrl.includes('/api/__clerk');

  try {
    const clerkRes = await fetch(`${proxyUrl}${CLERK_ENVIRONMENT_PROBE_PATH}`, {
      credentials: isProxy ? 'same-origin' : 'omit',
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
          'Clerk host is not recognized. Confirm Vercel Production CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY are the matching Clerk Production pk_live_* key, then redeploy without cache.',
        );
        return hints;
      } else if (clerkRes.status === 503) {
        hints.push(
          'Login service is unavailable (503). Confirm Vercel Production has the matching CLERK_SECRET_KEY, CLERK_PUBLISHABLE_KEY, and VITE_CLERK_PUBLISHABLE_KEY values, then redeploy without cache.',
        );
      } else if (clerkRes.status === 504 || clerkRes.status === 502) {
        hints.push(
          `Clerk connection upstream failed (${clerkRes.status}). Confirm CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY on Vercel.`,
        );
      } else {
        const detail = clerkErrorDetail(proxyError).replace(/[.]+$/, '');
        hints.push(
          `Clerk service check failed (${clerkRes.status})${detail ? `: ${detail}` : ''}. Confirm CLERK_SECRET_KEY and CLERK_PUBLISHABLE_KEY on Vercel.`,
        );
      }
    }
  } catch {
    if (isProxy) {
      hints.push(
        'Clerk proxy unreachable at /api/__clerk — the api-server must proxy to Clerk in production.',
      );
    } else {
      hints.push(
        `Clerk host unreachable (${proxyUrl}) — check your internet connection or ad blockers.`,
      );
    }
  }

  const scriptUrl = clerkJsScriptProbeUrl(clerkPubKey);
  if (scriptUrl) {
    try {
      const scriptRes = await fetch(scriptUrl, {
        method: 'GET',
        credentials: isProxy ? 'same-origin' : 'omit',
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });
      if (!scriptRes.ok) {
        hints.push(
          `Login script failed to load (${scriptRes.status}) via ${scriptUrl}.`,
        );
      }
    } catch {
      hints.push(
        `Clerk JS bundle could not be fetched from ${scriptUrl} — sign-in cannot start until this script loads.`,
      );
    }
  }

  if (import.meta.env.PROD && !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    hints.push(
      'VITE_CLERK_PUBLISHABLE_KEY was missing at build time — set it on Vercel and redeploy without cache.',
    );
  }

// Intentionally do NOT push stall/failure recovery hints here. Those are
  // decided by the UI after ClerkLoading stalls or ClerkFailed confirms
  // (see ClerkConnectivityHints in App.full.jsx).

  return hints;
}

/** Message shown only when Clerk UI is still loading after a stall timeout. */
export const CLERK_STALL_HINT =
  'API and Clerk look reachable, but the Clerk SDK has not finished loading. Disable ad blockers, try another browser, or refresh in a few seconds.';

/**
 * Message when Clerk has confirmed failure (ClerkFailed) but health/environment/script
 * probes all succeeded — e.g. script execution or SDK init failed in-browser.
 */
export const CLERK_FAILURE_HINT =
  'API and Clerk look reachable, but the Clerk SDK failed to initialize. Disable ad blockers, try another browser, or hard-refresh.';
