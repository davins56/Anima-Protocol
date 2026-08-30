import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  animaProductionClerkProxyUrl,
  clerkFrontendApiProbeBase,
  clerkJsScriptProbeUrl,
  clerkProviderOAuthCallbackUrl,
  clerkProxyProbeBase,
  decodeClerkFrontendHost,
  ensureTrailingSlash,
  isAnimaProductionHost,
  publishableKeyUsesCustomDomain,
  resolveClerkProxyUrl,
  shouldUseClerkProxy,
} from './clerkProxy';

const LIVE_CUSTOM_KEY =
  'pk_live_Y2xlcmsuYW5pbWEtcHJvdG9jb2wuY29tJA'; // pragma: allowlist secret (clerk.anima-protocol.com)
const LIVE_DEFAULT_KEY =
  'pk_live_Y2xlcmsucHJvZC5jbGVyay5hY2NvdW50cy5kZXYk'; // pragma: allowlist secret (clerk.prod.clerk.accounts.dev)
const TEST_KEY =
  'pk_test_Y2xlcmsuZGV2LmNsZXJrLmFjY291bnRzLmRldiQ'; // pragma: allowlist secret (clerk.dev.clerk.accounts.dev)

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

  it('correctly decodes frontend api host', () => {
    expect(decodeClerkFrontendHost(LIVE_CUSTOM_KEY)).toBe('clerk.anima-protocol.com');
    expect(decodeClerkFrontendHost(TEST_KEY)).toBe('clerk.dev.clerk.accounts.dev');
  });

  it('detects custom domains', () => {
    expect(publishableKeyUsesCustomDomain(LIVE_CUSTOM_KEY)).toBe(true);
    expect(publishableKeyUsesCustomDomain(LIVE_DEFAULT_KEY)).toBe(false);
    expect(publishableKeyUsesCustomDomain(TEST_KEY)).toBe(false);
  });

  it('skips proxy when custom domain is used', () => {
    expect(shouldUseClerkProxy(LIVE_CUSTOM_KEY)).toBe(false);
    expect(resolveClerkProxyUrl(LIVE_CUSTOM_KEY)).toBe('');
  });

  it('uses proxy on production for non-custom live keys', () => {
    expect(shouldUseClerkProxy(LIVE_DEFAULT_KEY)).toBe(true);
    expect(resolveClerkProxyUrl(LIVE_DEFAULT_KEY)).toBe('/api/__clerk/');
  });

  it('builds probe URLs correctly', () => {
    expect(clerkProxyProbeBase(LIVE_CUSTOM_KEY)).toBe('https://clerk.anima-protocol.com');
    expect(clerkJsScriptProbeUrl(LIVE_CUSTOM_KEY)).toBe(
      'https://clerk.anima-protocol.com/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
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
