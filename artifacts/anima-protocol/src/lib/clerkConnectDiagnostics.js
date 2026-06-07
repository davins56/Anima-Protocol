import { apiUrl } from '@/lib/apiOrigin';

/**
 * Probe API + Clerk proxy when Clerk JS fails to load. Returns human-readable
 * hints for the sign-in error UI.
 */
export async function probeClerkConnectivity() {
  const hints = [];
  const proxyUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/api/__clerk`;

  try {
    const healthRes = await fetch(apiUrl('/healthz'), { credentials: 'same-origin' });
    if (!healthRes.ok) {
      hints.push(`API health check failed (${healthRes.status}). Set DATABASE_URL and CLERK_SECRET_KEY on Vercel.`);
    }
  } catch {
    hints.push('API is unreachable — /api/healthz did not respond.');
  }

  try {
    const clerkRes = await fetch(`${proxyUrl}/v1/environment`, {
      credentials: 'same-origin',
    });
    if (!clerkRes.ok) {
      hints.push(
        `Clerk proxy failed (${clerkRes.status}). Confirm CLERK_SECRET_KEY on Vercel and remove VITE_CLERK_PROXY_URL=none if set.`,
      );
    }
  } catch {
    hints.push(
      'Clerk proxy unreachable at /api/__clerk — the api-server must proxy to Clerk in production.',
    );
  }

  if (import.meta.env.PROD && !import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    hints.push(
      'VITE_CLERK_PUBLISHABLE_KEY was missing at build time — set it on Vercel and redeploy without cache.',
    );
  }

  return hints;
}
