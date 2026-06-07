import { apiUrl } from '@/lib/apiOrigin';
import {
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
} from '@/lib/clerkProxy';

/**
 * Probe API + Clerk proxy when Clerk JS fails to load. Returns human-readable
 * hints for the sign-in error UI.
 */
export async function probeClerkConnectivity(clerkPubKey) {
  const hints = [];
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
      credentials: 'same-origin',
      signal: AbortSignal.timeout(8000),
    });
    proxyOk = clerkRes.ok;
    if (!clerkRes.ok) {
      let proxyDetail = '';
      try {
        const body = await clerkRes.clone().json();
        if (body?.error === 'clerk_proxy_invalid_secret') {
          proxyDetail =
            'CLERK_SECRET_KEY on Vercel is set to a publishable key (pk_…). Replace it with your Clerk secret key (sk_live_… or sk_test_…). Keep pk_live_… only in CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY.';
        } else if (body?.message) {
          proxyDetail = body.message;
        }
      } catch {
        // ignore non-JSON error bodies
      }

      if (clerkRes.status === 503) {
        hints.push(
          proxyDetail ||
            'Clerk proxy unavailable (503). Set CLERK_SECRET_KEY (sk_live_…) and CLERK_PUBLISHABLE_KEY (pk_live_…) on Vercel (Production), then redeploy without cache.',
        );
      } else if (clerkRes.status === 504 || clerkRes.status === 502) {
        hints.push(
          `Clerk proxy upstream failed (${clerkRes.status}). Redeploy the latest API build — the server now proxies Clerk via fetch on Vercel. Also confirm CLERK_SECRET_KEY is your Production sk_live_ key.`,
        );
      } else {
        hints.push(
          `Clerk proxy failed (${clerkRes.status}). Confirm CLERK_SECRET_KEY on Vercel and remove VITE_CLERK_PROXY_URL=none if set.`,
        );
      }
    }
  } catch {
    hints.push(
      'Clerk proxy unreachable at /api/__clerk — the api-server must proxy to Clerk in production.',
    );
  }

  const scriptUrl = clerkJsScriptProbeUrl(clerkPubKey);
  if (scriptUrl) {
    try {
      const scriptRes = await fetch(scriptUrl, {
        method: 'GET',
        credentials: 'same-origin',
        signal: AbortSignal.timeout(8000),
      });
      scriptOk = scriptRes.ok;
      if (!scriptRes.ok) {
        hints.push(
          `Clerk JS bundle failed to load (${scriptRes.status}) via ${scriptUrl}. Redeploy the API after merging the latest Clerk proxy fix.`,
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
