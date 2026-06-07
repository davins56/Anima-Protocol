import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeClerkConnectivity } from './clerkConnectDiagnostics';

const LIVE_KEY =
  'pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA'; // pragma: allowlist secret

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
    vi.stubEnv('VITE_CLERK_PUBLISHABLE_KEY', LIVE_KEY);
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
        if (String(url).endsWith('/api/__clerk/v1/environment')) {
          return new Response(
            JSON.stringify({ error: 'clerk_proxy_invalid_secret' }),
            { status: 503 },
          );
        }
        return new Response('', { status: 503 });
      }),
    );

    const hints = await probeClerkConnectivity(LIVE_KEY);

    expect(hints).toContain(
      'Clerk proxy is misconfigured: Vercel Production CLERK_SECRET_KEY is set to a publishable pk_* key. Replace it with the matching Clerk Production sk_live_* secret key, then redeploy without cache.',
    );
    expect(hints).toHaveLength(1);
    expect(fetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/npm/@clerk/clerk-js@6/dist/clerk.browser.js'),
      expect.anything(),
    );
  });
});
