import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

  
  it('does not emit a false-positive stall hint when probes succeed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        return new Response(JSON.stringify({ auth_config: {} }), { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(CUSTOM_DOMAIN_KEY);
    expect(hints).toEqual([]);
  });

  it('surfaces custom-domain 400 with Clerk error codes instead of blaming DNS only', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).endsWith('/api/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (String(url).includes('clerk.anima-protocol.com/v1/environment')) {
          return new Response(
            JSON.stringify({
              errors: [{ code: 'invalid_request', message: 'bad request' }],
            }),
            { status: 400 },
          );
        }
        return new Response('', { status: 200 });
      }),
    );

    const hints = await probeClerkConnectivity(CUSTOM_DOMAIN_KEY);
    expect(hints).toHaveLength(1);
    expect(hints[0]).toContain('returned 400');
    expect(hints[0]).toContain('invalid_request');
    expect(hints[0]).not.toMatch(/Confirm clerk\.anima-protocol\.com DNS in Clerk/);
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
        '/v1/environment?_clerk_api_version=2025-11-10&_clerk_js_version=6.12.1',
      ),
      expect.anything(),
    );
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
