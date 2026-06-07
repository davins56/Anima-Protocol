import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  animaProductionClerkProxyUrl,
  clerkJsScriptProbeUrl,
  clerkProxyProbeBase,
  ensureTrailingSlash,
  isAnimaProductionHost,
  resolveClerkProxyUrl,
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
