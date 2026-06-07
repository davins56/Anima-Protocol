import { describe, expect, it, vi, afterEach } from 'vitest';
import { probeClerkConnectivity } from './clerkConnectDiagnostics';

const LIVE_KEY = 'pk_live_Y2xlcmsuYWNjb3VudHMuZGV2JA';

describe('probeClerkConnectivity', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('surfaces clerk_proxy_invalid_secret when the API returns 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url) => {
        if (String(url).includes('/healthz')) {
          return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
        }
        if (String(url).includes('/v1/environment')) {
          return new Response(
            JSON.stringify({
              error: 'clerk_proxy_invalid_secret',
              message:
                'CLERK_SECRET_KEY must be a secret key (sk_live_… or sk_test_…), not a publishable key.',
            }),
            { status: 503 },
          );
        }
        return new Response('', { status: 404 });
      }),
    );

    const hints = await probeClerkConnectivity(LIVE_KEY);
    expect(hints.some((h) => h.includes('publishable key (pk_'))).toBe(true);
  });
});
