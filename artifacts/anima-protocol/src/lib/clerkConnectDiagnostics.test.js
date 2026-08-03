import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLERK_STALL_HINT,
  isClerkProxyHealthy,
  probeClerkConnectivity,
} from './clerkConnectDiagnostics';

// Production-shaped key with an accounts.dev host so production probes /api/__clerk.
const LIVE_KEY =
  'pk_live_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ';
const CUSTOM_DOMAIN_KEY =
  'pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA'; // pragma: allowlist secret
// Production-shaped key for a non-custom Clerk host, so probes target /api/__clerk.
const PROXY_LIVE_KEY =
  'pk_live_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ'; // pragma: allowlist secret
const DEV_KEY =
  'pk_test_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ'; // pragma: allowlist secret

describe('probeClerkConnectivity', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'www.anima-protocol.com',
        origin: 'https://www.anima-protocol.com',
      },
    });
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_CLERK_PROXY_URL', '');
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', PROXY_LIVE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('surfaces invalid Vercel CLERK_SECRET_KEY configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
          });
        }
        if (
          String(url).includes('/v1/environment') &&
          String(url).includes('/api/__clerk')
        ) {
          return new Response(
            JSON.stringify({ error: 'clerk_proxy_invalid_secret' }),
            { status: 503 },
          );
        }
        return new Response('', { status: 503 });
      }),
    );

    const hints = await probeClerkConnectivity(PROXY_LIVE_KEY);

    expect(hints).toContain(
      'Clerk proxy is misconfigured: Vercel Production CLERK_SECRET_KEY is set to a publishable pk_* key. Replace it with the matching Clerk Production sk_live_* secret key, then redeploy without cache.',
    );
    expect(hints).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/npm/@clerk/clerk-js@6/dist/clerk.browser.js'),
      expect.anything(),
    );
  });

  it('surfaces Clerk host mismatch from publishable key or proxy URL configuration', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
          });
        }
        if (String(url).includes('/api/__clerk/v1/environment')) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  code: 'host_invalid',
                  message: 'Invalid host',
                },
              ],
            }),
            { status: 400 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(PROXY_LIVE_KEY);

    expect(hints).toContain(
      'Clerk proxy host is not recognized, so all sign-in and sign-up links will fail. Confirm Vercel Production CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY are the matching Clerk Production pk_live_* key, Clerk Dashboard Proxy URL is https://www.anima-protocol.com/api/__clerk, then redeploy without cache.',
    );
    expect(hints).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/npm/@clerk/clerk-js@6/dist/clerk.browser.js'),
      expect.anything(),
    );
  });

  it('returns no proxy stall hint when probes succeed (stall copy is UI-gated)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ status: 'ok' }), {
        status: 200,
      })),
    );

    // Healthy probes must stay quiet — CLERK_STALL_HINT is shown by the UI
    // only after ClerkLoading actually stalls / ClerkFailed.
    await expect(probeClerkConnectivity(PROXY_LIVE_KEY)).resolves.toEqual([]);
    expect(CLERK_STALL_HINT).toMatch(/SDK has not finished loading/i);
  });

  it('surfaces Clerk custom domain subdomain allowlist failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
          });
        }
        if (String(url).includes('clerk.anima-protocol.com/v1/environment')) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  code: 'subdomain_not_allowed',
                  message: 'Subdomain not allowed',
                },
              ],
            }),
            { status: 403 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(CUSTOM_DOMAIN_KEY);

    expect(hints).toEqual([
      'Clerk is rejecting www.anima-protocol.com for the custom login domain. In Clerk Dashboard → Domains, add www.anima-protocol.com to the allowed subdomains for clerk.anima-protocol.com, then hard-refresh sign-in.',
    ]);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining(
        '/v1/environment?__clerk_api_version=2025-11-10&_clerk_js_version=6.12.1',
      ),
      expect.anything(),
    );
  });

  it('surfaces custom-domain host_invalid with Domains guidance', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
          });
        }
        if (String(url).includes('clerk.anima-protocol.com/v1/environment')) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  code: 'host_invalid',
                  message: 'Invalid host',
                  long_message:
                    'We were unable to attribute this request to an instance running on Clerk.',
                },
              ],
            }),
            { status: 400 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(CUSTOM_DOMAIN_KEY);

    expect(hints).toEqual([
      'Clerk custom domain host is not recognized. Confirm Vercel Production CLERK_PUBLISHABLE_KEY and VITE_CLERK_PUBLISHABLE_KEY are the matching Clerk Production pk_live_* key for clerk.anima-protocol.com, and that domain is verified in Clerk → Domains.',
    ]);
  });

  it('includes Clerk error detail for generic custom-domain failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
          });
        }
        if (String(url).includes('clerk.anima-protocol.com/v1/environment')) {
          return new Response(
            JSON.stringify({
              errors: [
                {
                  code: 'something_else',
                  message: 'Bad request',
                  long_message: 'Custom domain is not fully provisioned.',
                },
              ],
            }),
            { status: 400 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(CUSTOM_DOMAIN_KEY);

    expect(hints).toEqual([
      'Clerk custom domain failed (400) at https://clerk.anima-protocol.com: Custom domain is not fully provisioned. Confirm clerk.anima-protocol.com is verified in Clerk → Domains and DNS CNAMEs to frontend-api.clerk.services.',
    ]);
  });

  it('returns no hints when probes succeed (stall copy is UI-gated)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), {
            status: 200,
          });
        }
        return new Response('{}', { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(CUSTOM_DOMAIN_KEY);

    // Healthy probes must stay quiet — CLERK_STALL_HINT is shown by the UI
    // only after ClerkLoading actually stalls / ClerkFailed.
    expect(hints).toEqual([]);
    expect(CLERK_STALL_HINT).toMatch(/SDK has not finished loading/i);
  });
});

describe('isClerkProxyHealthy', () => {
  beforeEach(() => {
    vi.stubGlobal('window', {
      location: {
        hostname: 'www.anima-protocol.com',
        origin: 'https://www.anima-protocol.com',
      },
    });
    vi.stubEnv('PROD', true);
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_CLERK_PROXY_URL', '');
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', PROXY_LIVE_KEY);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('returns false when the Clerk proxy responds with 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 503 })),
    );

    await expect(isClerkProxyHealthy(PROXY_LIVE_KEY)).resolves.toBe(false);
  });

  it('returns true when proxy is not used', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', DEV_KEY);

    await expect(isClerkProxyHealthy(DEV_KEY)).resolves.toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
