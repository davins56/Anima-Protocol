import { apiUrl } from '@/lib/apiOrigin';
import {
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
  resolveClerkProxyUrl,
} from '@/lib/clerkProxy';

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
 * Quick health check for an explicitly configured Clerk proxy. Direct Clerk
 * mode is healthy by definition here because ClerkProvider owns that connection.
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

/** Probe the Cloudflare API and any explicitly configured Clerk proxy. */
export async function probeClerkConnectivity(clerkPubKey) {
  const hints = [];
  const proxyUrl = clerkProxyProbeBase(clerkPubKey);

  try {
    const healthRes = await fetch(apiUrl('/healthz'), {
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    if (!healthRes.ok) {
      hints.push(
        `API health check failed (${healthRes.status}). Confirm DATABASE_URL and CLERK_SECRET_KEY are set as Cloudflare Worker secrets and redeploy.`,
      );
    }
  } catch {
    hints.push('API is unreachable — Cloudflare did not return /api/healthz.');
  }

  // Only probe /api/__clerk when the operator explicitly enabled a proxy.
  if (proxyUrl) {
    try {
      const clerkRes = await fetch(`${proxyUrl}${CLERK_ENVIRONMENT_PROBE_PATH}`, {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(8000),
      });
      if (!clerkRes.ok) {
        const proxyError = await readProxyError(clerkRes);
        const codes = clerkErrorCodes(proxyError);
        if (proxyError?.error === 'clerk_proxy_invalid_secret') {
          hints.push(
            'Clerk proxy is misconfigured: Cloudflare CLERK_SECRET_KEY must be the matching Production sk_live_* secret key, not a publishable pk_* key.',
          );
          return hints;
        } else if (codes.includes('host_invalid')) {
          hints.push(
            'Clerk proxy host is not recognized. Confirm the Clerk Production keys and the configured VITE_CLERK_PROXY_URL, or remove VITE_CLERK_PROXY_URL to use Clerk directly.',
          );
          return hints;
        } else if (clerkRes.status === 503) {
          hints.push(
            'Login proxy is unavailable (503). Confirm CLERK_SECRET_KEY on Cloudflare, or remove VITE_CLERK_PROXY_URL to use Clerk directly.',
          );
        } else if (clerkRes.status === 504 || clerkRes.status === 502) {
          hints.push(
            `Clerk proxy upstream failed (${clerkRes.status}). Check the Cloudflare Worker deployment or disable the optional proxy.`,
          );
        } else {
          const detail = clerkErrorDetail(proxyError).replace(/[.]+$/, '');
          hints.push(
            `Clerk proxy failed (${clerkRes.status})${detail ? `: ${detail}` : ''}. Check Cloudflare Worker secrets or remove VITE_CLERK_PROXY_URL to use Clerk directly.`,
          );
        }
      }
    } catch {
      hints.push(
        'The explicitly configured Clerk proxy is unreachable. Remove VITE_CLERK_PROXY_URL to use Clerk directly, or repair the Cloudflare proxy route.',
      );
    }

    const scriptUrl = clerkJsScriptProbeUrl(clerkPubKey);
    if (scriptUrl) {
      try {
        const scriptRes = await fetch(scriptUrl, {
          method: 'GET',
          credentials: 'same-origin',
          redirect: 'follow',
          signal: AbortSignal.timeout(8000),
        });
        if (!scriptRes.ok) {
          hints.push(
            `Login script failed to load (${scriptRes.status}) via ${scriptUrl}. Repair the configured Clerk proxy or disable it.`,
          );
        }
      } catch {
        hints.push(
          'Clerk JS could not be fetched through the explicitly configured proxy. Repair the proxy or disable it.',
        );
      }
    }
  }

  if (import.meta.env.PROD && !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    hints.push(
      'VITE_CLERK_PUBLISHABLE_KEY was missing at build time. Add it to the Cloudflare build environment and redeploy.',
    );
  }

  return hints;
}

export const CLERK_STALL_HINT =
  'The API is reachable, but Clerk has not finished loading. Check the production publishable key and network requests, then refresh.';

export const CLERK_FAILURE_HINT =
  'The API is reachable, but Clerk failed to initialize. Confirm VITE_CLERK_PUBLISHABLE_KEY is the matching Production pk_live_* key and redeploy the Cloudflare build.';
