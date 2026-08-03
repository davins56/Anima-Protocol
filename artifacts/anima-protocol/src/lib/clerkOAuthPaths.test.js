import { describe, expect, it } from 'vitest';
import {
  clerkOAuthCallbackAbsolute,
  clerkOAuthCompletePath,
  clerkOAuthRedirectPaths,
  clerkSsoCallbackPath,
  joinBasePath,
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
});
