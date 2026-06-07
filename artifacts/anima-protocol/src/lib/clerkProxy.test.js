import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  animaProductionClerkProxyUrl,
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

  it('uses canonical www proxy on production anima hosts', () => {
    expect(resolveClerkProxyUrl(LIVE_KEY)).toBe(animaProductionClerkProxyUrl());
    window.location.hostname = 'anima-protocol.com';
    window.location.origin = 'https://anima-protocol.com';
    expect(resolveClerkProxyUrl(LIVE_KEY)).toBe(animaProductionClerkProxyUrl());
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
