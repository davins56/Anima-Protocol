import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  animaProductionClerkProxyUrl,
  clerkFrontendApiBase,
  clerkFrontendApiHost,
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
  ensureTrailingSlash,
  isAnimaProductionHost,
  resolveClerkProxyUrl,
  shouldFallbackToDirectClerk,
  shouldUseClerkProxy,
} from './clerkProxy';

const LIVE_KEY =
  'pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA'; // pragma: allowlist secret
const TEST_KEY =
  'pk_test_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ'; // pragma: allowlist secret

describe('clerkProxy', () => {
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
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('adds trailing slash to proxy URLs', () => {
    expect(ensureTrailingSlash('https://example.com/api/__clerk')).toBe(
      'https://example.com/api/__clerk/',
    );
  });

  it('uses relative same-origin proxy path for ClerkProvider', () => {
    expect(resolveClerkProxyUrl(LIVE_KEY)).toBe('/api/__clerk/');
    window.location.hostname = 'anima-protocol.com';
    window.location.origin = 'https://anima-protocol.com';
    expect(resolveClerkProxyUrl(LIVE_KEY)).toBe('/api/__clerk/');
  });

  it('builds probe URLs from the current origin', () => {
    expect(clerkProxyProbeBase(LIVE_KEY)).toBe(
      'https://www.anima-protocol.com/api/__clerk',
    );
    expect(clerkJsScriptProbeUrl(LIVE_KEY)).toContain(
      '/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
    );
  });

  it('derives the direct Clerk Frontend API from the publishable key', () => {
    expect(clerkFrontendApiHost(LIVE_KEY)).toBe('clerk.anima-protocol.com');
    expect(clerkFrontendApiBase(LIVE_KEY)).toBe(
      'https://clerk.anima-protocol.com',
    );
  });

  it('falls back to direct Clerk only when proxy fails and direct works', async () => {
    const fetchImpl = vi.fn(async (url) => ({
      ok: String(url).startsWith('https://clerk.anima-protocol.com'),
    }));

    await expect(shouldFallbackToDirectClerk(LIVE_KEY, fetchImpl)).resolves.toBe(
      true,
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://www.anima-protocol.com/api/__clerk/v1/environment',
      expect.objectContaining({ credentials: 'omit' }),
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://clerk.anima-protocol.com/v1/environment',
      expect.objectContaining({ credentials: 'omit' }),
    );
  });

  it('keeps the proxy when the proxy health check succeeds', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }));

    await expect(shouldFallbackToDirectClerk(LIVE_KEY, fetchImpl)).resolves.toBe(
      false,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('skips proxy for pk_test_', () => {
    expect(shouldUseClerkProxy(TEST_KEY)).toBe(false);
    expect(resolveClerkProxyUrl(TEST_KEY)).toBe('');
  });

  it('detects anima production hosts', () => {
    expect(isAnimaProductionHost('www.anima-protocol.com')).toBe(true);
    expect(isAnimaProductionHost('anima-protocol.com')).toBe(true);
    expect(isAnimaProductionHost('preview.vercel.app')).toBe(false);
  });
});
