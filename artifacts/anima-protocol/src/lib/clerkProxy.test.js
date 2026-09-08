import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  ANIMA_PRODUCTION_SIGN_IN_URL,
  animaProductionClerkProxyUrl,
  clerkFrontendApiProbeBase,
  clerkJsScriptProbeUrl,
  clerkProviderOAuthCallbackUrl,
  clerkProxyProbeBase,
  decodeClerkFrontendHost,
  ensureTrailingSlash,
  isAnimaProductionHost,
  isClerkAuthorizedBrowserHost,
  isUsableClerkPublishableKey,
  publishableKeyUsesCustomDomain,
  resolveClerkProxyUrl,
  sanitizeClerkPublishableKey,
  shouldUseClerkProxy,
  mustUseSameOriginClerkProxy,
  shouldAllowDirectClerkFallback,
  expireBrowserApexClerkClientUatCookies,
  isBrowserClerkAuthCookieName,
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
    expect(decodeClerkFrontendHost('pk_test_placeholder')).toBe('');
    expect(decodeClerkFrontendHost(LIVE_CUSTOM_KEY)).toBe('clerk.anima-protocol.com');
    expect(decodeClerkFrontendHost(TEST_KEY)).toBe('clerk.dev.clerk.accounts.dev');
  });

  it('treats placeholder and mojibake keys as unset', () => {
    expect(isUsableClerkPublishableKey('pk_test_placeholder')).toBe(false);
    expect(sanitizeClerkPublishableKey('pk_test_placeholder')).toBe('');
    expect(clerkJsScriptProbeUrl('pk_test_placeholder')).toBe('');
    expect(clerkFrontendApiProbeBase('pk_test_placeholder')).toBe('');
    expect(isUsableClerkPublishableKey(LIVE_CUSTOM_KEY)).toBe(true);
    expect(sanitizeClerkPublishableKey(LIVE_CUSTOM_KEY)).toBe(LIVE_CUSTOM_KEY);
    expect(shouldUseClerkProxy(LIVE_CUSTOM_KEY)).toBe(true);
  });

  it('detects custom domains', () => {
    expect(publishableKeyUsesCustomDomain(LIVE_CUSTOM_KEY)).toBe(true);
    expect(publishableKeyUsesCustomDomain(LIVE_DEFAULT_KEY)).toBe(false);
    expect(publishableKeyUsesCustomDomain(TEST_KEY)).toBe(false);
  });

  it('uses the same-origin proxy on production even for custom-domain pk_live_ keys', () => {
    expect(publishableKeyUsesCustomDomain(LIVE_CUSTOM_KEY)).toBe(true);
    expect(mustUseSameOriginClerkProxy(LIVE_CUSTOM_KEY, 'anima-protocol.com')).toBe(
      true,
    );
    expect(shouldAllowDirectClerkFallback(LIVE_CUSTOM_KEY, 'anima-protocol.com')).toBe(
      false,
    );
    expect(shouldUseClerkProxy(LIVE_CUSTOM_KEY)).toBe(true);
    expect(resolveClerkProxyUrl(LIVE_CUSTOM_KEY)).toBe('/api/__clerk/');
    expect(mustUseSameOriginClerkProxy(LIVE_CUSTOM_KEY, 'preview.vercel.app')).toBe(
      false,
    );
    expect(mustUseSameOriginClerkProxy(TEST_KEY, 'anima-protocol.com')).toBe(false);
    expect(shouldAllowDirectClerkFallback(TEST_KEY, 'anima-protocol.com')).toBe(
      true,
    );
  });

  it('ignores VITE_CLERK_PROXY_URL=none on production pk_live_', () => {
    vi.stubEnv('VITE_CLERK_PROXY_URL', 'none');
    expect(mustUseSameOriginClerkProxy(LIVE_CUSTOM_KEY, 'anima-protocol.com')).toBe(
      true,
    );
    expect(shouldAllowDirectClerkFallback(LIVE_CUSTOM_KEY, 'anima-protocol.com')).toBe(
      false,
    );
    expect(shouldUseClerkProxy(LIVE_CUSTOM_KEY)).toBe(true);
    expect(resolveClerkProxyUrl(LIVE_CUSTOM_KEY)).toBe('/api/__clerk/');
  });

  it('uses proxy on production for non-custom live keys', () => {
    expect(shouldUseClerkProxy(LIVE_DEFAULT_KEY)).toBe(true);
    expect(resolveClerkProxyUrl(LIVE_DEFAULT_KEY)).toBe('/api/__clerk/');
  });

  it('builds probe URLs correctly', () => {
    expect(clerkProxyProbeBase(LIVE_CUSTOM_KEY)).toBe(
      'https://www.anima-protocol.com/api/__clerk',
    );
    expect(clerkJsScriptProbeUrl(LIVE_CUSTOM_KEY)).toBe(
      'https://www.anima-protocol.com/api/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js',
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

  it('authorizes only anima and local hosts for production Clerk', () => {
    expect(isClerkAuthorizedBrowserHost('anima-protocol.com')).toBe(true);
    expect(isClerkAuthorizedBrowserHost('www.anima-protocol.com')).toBe(true);
    expect(isClerkAuthorizedBrowserHost('localhost')).toBe(true);
    expect(isClerkAuthorizedBrowserHost('anima-protocol-abc.vercel.app')).toBe(
      false,
    );
    expect(ANIMA_PRODUCTION_SIGN_IN_URL).toBe(
      'https://anima-protocol.com/sign-in',
    );
    expect(animaProductionClerkProxyUrl()).toBe(
      'https://anima-protocol.com/api/__clerk/',
    );
  });

  it('expires Domain=apex and Domain=.apex Clerk auth cookies on production hosts', () => {
    expect(isBrowserClerkAuthCookieName('__session')).toBe(true);
    expect(isBrowserClerkAuthCookieName('__client')).toBe(true);
    expect(isBrowserClerkAuthCookieName('theme')).toBe(false);
    const written = [];
    expireBrowserApexClerkClientUatCookies({
      cookie: '__client_uat=0; __client_uat_23i07izR=0; __session=stale; theme=dark',
      hostname: 'anima-protocol.com',
      writeCookie: (value) => written.push(value),
    });
    expect(written).toEqual([
      '__client_uat=; Path=/; Domain=anima-protocol.com; Max-Age=0; Secure; SameSite=Lax',
      '__client_uat=; Path=/; Domain=.anima-protocol.com; Max-Age=0; Secure; SameSite=Lax',
      '__client_uat_23i07izR=; Path=/; Domain=anima-protocol.com; Max-Age=0; Secure; SameSite=Lax',
      '__client_uat_23i07izR=; Path=/; Domain=.anima-protocol.com; Max-Age=0; Secure; SameSite=Lax',
      '__session=; Path=/; Domain=anima-protocol.com; Max-Age=0; Secure; SameSite=Lax',
      '__session=; Path=/; Domain=.anima-protocol.com; Max-Age=0; Secure; SameSite=Lax',
    ]);
    expect(
      expireBrowserApexClerkClientUatCookies({
        cookie: '__client_uat=0',
        hostname: 'localhost',
        writeCookie: (value) => written.push(value),
      }),
    ).toEqual([]);
  });
});
