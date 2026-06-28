import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animaApi } from './animaApi';
import { base44, clearAuthTokenGetter, setAuthTokenGetter } from './base44Client';

describe('API auth bridge', () => {
  beforeEach(() => {
    setAuthTokenGetter(() => 'test-token');
    global.fetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ result: { ok: true } }),
      }),
    );
  });

  afterEach(() => {
    clearAuthTokenGetter();
    vi.restoreAllMocks();
    delete global.fetch;
  });

  it('attaches Clerk and public-host headers to function invokes', async () => {
    await base44.functions.invoke('debugApp', {});

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(options.headers['X-Anima-Public-Host']).toBe(window.location.host);
    expect(options.headers['X-Forwarded-Host']).toBe(window.location.host);
  });

  it('attaches Clerk and public-host headers to animaApi requests', async () => {
    await animaApi.conversations.list();

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(options.headers['X-Anima-Public-Host']).toBe(window.location.host);
    expect(options.credentials).toBe('same-origin');
  });
});
