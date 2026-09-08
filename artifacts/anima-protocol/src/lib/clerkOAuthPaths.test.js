import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  CLERK_GITHUB_OAUTH_CALLBACK_URL,
  clerkOAuthCallbackAbsolute,
  clerkOAuthCompletePath,
  clerkOAuthRedirectPaths,
  clerkSsoCallbackPath,
  destinationAfterClerkAuth,
  hasClerkHandshakeQuery,
  hasPendingClerkHandshake,
  joinBasePath,
  resolvePostAuthNavigation,
} from './clerkOAuthPaths';

describe('clerkOAuthPaths', () => {
  it('joins base path without double slashes', () => {
    expect(joinBasePath('', 'sign-in/sso-callback')).toBe('/sign-in/sso-callback');
    expect(joinBasePath('/app', 'sign-in/sso-callback')).toBe('/app/sign-in/sso-callback');
  });

  it('returns mode-specific SSO callback paths', () => {
    expect(clerkSsoCallbackPath('', 'sign-in')).toBe('/sign-in/sso-callback');
    expect(clerkSsoCallbackPath('', 'sign-up')).toBe('/sign-up/sso-callback');
    expect(clerkSsoCallbackPath('/__mockup', 'sign-in')).toBe(
      '/__mockup/sign-in/sso-callback',
    );
  });

  it('returns relative redirect paths for signIn.sso', () => {
    expect(clerkOAuthRedirectPaths('', 'sign-up')).toEqual({
      redirectCallbackUrl: '/sign-up/sso-callback',
      redirectUrl: '/',
    });
    expect(clerkOAuthRedirectPaths('/__mockup', 'sign-in')).toEqual({
      redirectCallbackUrl: '/__mockup/sign-in/sso-callback',
      redirectUrl: '/__mockup',
    });
  });

  it('builds absolute callback URLs for dashboard hints only', () => {
    expect(
      clerkOAuthCallbackAbsolute('https://preview.vercel.app', '', 'sign-up'),
    ).toBe('https://preview.vercel.app/sign-up/sso-callback');
  });

  it('normalizes complete path for nested base', () => {
    expect(clerkOAuthCompletePath('/__mockup')).toBe('/__mockup');
    expect(clerkOAuthCompletePath('')).toBe('/');
  });

  it('pins post-auth navigation to the app, never the Clerk FAPI host', () => {
    expect(
      resolvePostAuthNavigation('https://clerk.anima-protocol.com/', {
        fallbackPath: '/',
        origin: 'https://anima-protocol.com',
      }),
    ).toEqual({ mode: 'in-app', path: '/' });
    expect(
      resolvePostAuthNavigation('/', {
        fallbackPath: '/home',
        origin: 'https://anima-protocol.com',
      }),
    ).toEqual({ mode: 'in-app', path: '/' });
    expect(
      resolvePostAuthNavigation('https://anima-protocol.com/?__clerk_handshake=1', {
        fallbackPath: '/',
        origin: 'https://anima-protocol.com',
      }),
    ).toEqual({ mode: 'in-app', path: '/?__clerk_handshake=1' });
    expect(
      destinationAfterClerkAuth({
        session: { currentTask: { key: 'choose-organization' } },
        decorateUrl: (path) => `https://clerk.anima-protocol.com${path}`,
        fallbackPath: '/',
        origin: 'https://anima-protocol.com',
      }),
    ).toEqual({ mode: 'in-app', path: '/' });
    expect(
      resolvePostAuthNavigation(
        'https://clerk.anima-protocol.com/?__clerk_handshake=tok',
        {
          fallbackPath: '/',
          origin: 'https://anima-protocol.com',
        },
      ),
    ).toEqual({ mode: 'in-app', path: '/?__clerk_handshake=tok' });
  });

  it('detects Clerk handshake query and SSO callback paths', () => {
    expect(
      hasClerkHandshakeQuery({ search: '?__clerk_handshake=1' }),
    ).toBe(true);
    expect(hasClerkHandshakeQuery({ search: '' })).toBe(false);
    expect(
      hasPendingClerkHandshake({
        pathname: '/sign-in/sso-callback',
        search: '',
      }),
    ).toBe(true);
    expect(
      hasPendingClerkHandshake({ pathname: '/', search: '' }),
    ).toBe(false);
  });

  it('documents the Clerk custom-domain GitHub OAuth callback', () => {
    expect(CLERK_GITHUB_OAUTH_CALLBACK_URL).toBe(
      'https://clerk.anima-protocol.com/v1/oauth_callback',
    );
  });

  it('keeps HandleSSOCallback Future wiring on /sign-in/sso-callback', () => {
    const app = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'ProtocolApp.jsx'),
      'utf8',
    );
    expect(app).toMatch(/HandleSSOCallback/);
    expect(app).toMatch(/navigateToApp=\{navigateAfterAuth\}/);
    expect(app).toMatch(/navigateToSignIn=/);
    expect(app).toMatch(/navigateToSignUp=/);
    expect(app).toMatch(/destinationAfterClerkAuth/);
    expect(app).toMatch(/decorateUrl/);
    expect(app).toMatch(/signInForceRedirectUrl=\{authRedirectCompleteUrl\}/);
    expect(app).toMatch(/allowedRedirectOrigins/);
    expect(app).toMatch(/path="\/sign-in\/sso-callback"/);
    expect(app).toMatch(/path="\/sign-up\/sso-callback"/);
    expect(app).toMatch(/mustUseSameOriginClerkProxy/);
    expect(app).toMatch(/shouldAllowDirectClerkFallback/);
    expect(app).toMatch(/lockSameOriginClerkProxy/);
    expect(app).toMatch(
      /function AuthFormShell\([\s\S]*?useEffect\(\(\) => \{[\s\S]*?expireBrowserApexClerkClientUatCookies\(\);/,
    );
    expect(app).toMatch(
      /function AuthFormShell\([\s\S]*?searchParams\.get\("clerk_error"\)/,
    );
    expect(app).toMatch(
      /function SsoCallbackPage\(\) \{[\s\S]*?useEffect\(\(\) => \{[\s\S]*?expireBrowserApexClerkClientUatCookies\(\);[\s\S]*?markClerkAuthReturn/,
    );
    expect(app).not.toMatch(
      /const initialClerkProxyUrl[\s\S]{0,120}expireBrowserApexClerkClientUatCookies\(\)/,
    );
    expect(app).toMatch(/CLERK_PROXY_REQUIRED_HINT/);
    expect(app).toMatch(/proxyRequiredFailed/);
    expect(app).toMatch(/setProxyRequiredFailed\(true\)/);
    expect(app).toMatch(/lockSameOriginClerkProxy && !nextUseProxy\) return/);
  });
});
