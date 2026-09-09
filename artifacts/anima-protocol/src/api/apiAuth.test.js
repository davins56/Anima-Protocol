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

  it('posts code repair analysis requests through the authenticated API helper', async () => {
    await animaApi.codeRepair.analyze({
      issue: 'OpenRouter 429 free-models-per-day',
      context: { surface: 'test' },
    });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/api/code-repair/analyze');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer test-token');
    expect(JSON.parse(options.body)).toEqual({
      issue: 'OpenRouter 429 free-models-per-day',
      context: { surface: 'test' },
    });
  });

  it('posts Serenity protocol upgrades through the authenticated API helper', async () => {
    await animaApi.protocolUpgrade.launch({
      request: 'Upgrade the interface to be darker.',
      scope: 'interface',
      surface: 'test',
    });

    const [url, options] = global.fetch.mock.calls[0];
    expect(String(url)).toContain('/api/protocol-upgrade');
    expect(options.method).toBe('POST');
    expect(JSON.parse(options.body)).toEqual({
      request: 'Upgrade the interface to be darker.',
      scope: 'interface',
      session_id: undefined,
      surface: 'test',
    });
  });

  it('unwraps a double-wrapped token getter instead of stringifying the function', async () => {
    // Classic mistake: treating setAuthTokenGetter like React setState.
    setAuthTokenGetter(() => async () => 'unwrapped-token');

    await base44.functions.invoke('debugApp', {});

    const [, options] = global.fetch.mock.calls[0];
    expect(options.headers.Authorization).toBe('Bearer unwrapped-token');
    expect(String(options.headers.Authorization)).not.toContain('async');
  });

  it('refuses to POST /openai/invoke without a Bearer token', async () => {
    clearAuthTokenGetter();

    const result = await base44.functions.invoke('debugApp', {});

    expect(result).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('retries /openai/invoke once after a 401 with a fresh Clerk token', async () => {
    const getter = vi
      .fn()
      .mockResolvedValueOnce('stale-token')
      .mockResolvedValueOnce('fresh-token');
    setAuthTokenGetter(getter);

    global.fetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { ok: true } }),
      });

    const result = await base44.functions.invoke('debugApp', {});

    expect(result).toEqual({ ok: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][1].headers.Authorization).toBe(
      'Bearer stale-token',
    );
    expect(global.fetch.mock.calls[1][1].headers.Authorization).toBe(
      'Bearer fresh-token',
    );
    expect(getter).toHaveBeenCalledWith({ skipCache: true });
  });
});
