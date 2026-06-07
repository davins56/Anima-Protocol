import React, {
  createContext,
  useState,
  useContext,
  useEffect,
  useCallback,
} from 'react';
import { useUser, useClerk, useAuth as useClerkAuth } from '@clerk/react';
import { useNavigate } from 'react-router-dom';
import {
  base44,
  setAuthTokenGetter,
  clearAuthTokenGetter,
  startStoreSync,
  stopStoreSync,
} from '@/api/base44Client';
import {
  identifyUser,
  setProfile,
  setProfileOnce,
  registerSuper,
  resetUser,
  track,
} from '@/lib/analytics';

const AuthContext = createContext();

// Bridges Clerk's session into the app's existing auth interface. Identity is
// owned by Clerk; the server profile record (reached via base44.auth.me())
// holds the profile and settings data the rest of the app already reads.
export const AuthProvider = ({ children }) => {
  const { user: clerkUser, isLoaded, isSignedIn } = useUser();
  const { signOut } = useClerk();
  const { getToken } = useClerkAuth();
  const navigate = useNavigate();

  const [user, setUser] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [isLoadingPublicSettings] = useState(false);
  const [appPublicSettings] = useState(null);

  // Make the Clerk session token available to the non-React data layer so
  // every entity/profile request can identify the user (in dev and prod).
  useEffect(() => {
    if (!isSignedIn) {
      clearAuthTokenGetter();
      return;
    }
    setAuthTokenGetter(() => async () => {
      try {
        const token = await getToken();
        if (token) return token;
        return await getToken({ skipCache: true });
      } catch (err) {
        console.warn("[Anima] Clerk getToken failed:", err);
        return null;
      }
    });
  }, [getToken, isSignedIn]);

  // Poll for cross-device changes only while signed in; stop on sign-out so we
  // never hit the per-user store endpoint without a session.
  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn) {
      startStoreSync();
    } else {
      stopStoreSync();
    }
    return () => {
      stopStoreSync();
    };
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;

    if (isSignedIn && clerkUser) {
      const identity = {
        id: clerkUser.id,
        email: clerkUser.primaryEmailAddress?.emailAddress || '',
        full_name: clerkUser.fullName || clerkUser.username || 'Seeker',
      };
      base44.auth.syncIdentity(identity);

      (async () => {
        try {
          let profile = await base44.auth.me();
          // A profile with no display_name is a brand-new account on its first
          // load — the only reliable client-side signal we have for sign-up.
          const isNewAccount = !profile.display_name;
          if (isNewAccount) {
            const preferred =
              clerkUser.firstName || clerkUser.fullName || clerkUser.username;
            if (preferred) {
              profile = await base44.auth.updateMe({ display_name: preferred });
            }
          }

          // Identity must come before any track() so events attribute correctly.
          // Use Clerk's stable user id as distinct_id (never the email).
          identifyUser(clerkUser.id);
          setProfile({
            $name: clerkUser.fullName || clerkUser.username || 'Seeker',
            $email: clerkUser.primaryEmailAddress?.emailAddress || undefined,
          });
          setProfileOnce({ first_seen_at: new Date().toISOString() });
          registerSuper({ platform: 'web' });

          if (isNewAccount) {
            track('sign_up_completed', {
              sign_up_method:
                clerkUser.externalAccounts?.[0]?.provider || 'email',
              platform: 'web',
            });
          }

          if (!cancelled) {
            setUser(profile);
            setAuthError(null);
          }
        } catch (err) {
          console.warn('Failed to load profile:', err);
          if (!cancelled) {
            setUser(base44.auth.syncIdentity(identity));
            setAuthError(null);
          }
        }
      })();
    } else {
      clearAuthTokenGetter();
      base44.auth.clearSession();
      setUser(null);
    }

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, clerkUser?.id]);

  const isAuthenticated = !!isSignedIn;
  const isLoadingAuth = !isLoaded;
  const [authStalled, setAuthStalled] = useState(false);

  useEffect(() => {
    if (!isLoadingAuth) {
      setAuthStalled(false);
      return;
    }
    const onAuthScreen =
      typeof window !== 'undefined' &&
      (window.location.pathname === '/sign-in' ||
        window.location.pathname === '/sign-up' ||
        window.location.pathname.startsWith('/sign-in/') ||
        window.location.pathname.startsWith('/sign-up/'));
    const stallMs = onAuthScreen ? 15_000 : 5_000;
    const timer = setTimeout(() => setAuthStalled(true), stallMs);
    return () => clearTimeout(timer);
  }, [isLoadingAuth]);

  const navigateToLogin = useCallback(() => {
    navigate('/sign-in');
  }, [navigate]);

  // Clerk owns the session and the post-logout redirect. We always land
  // signed-out users on the public landing page ("/"), never the bare
  // sign-in screen.
  const logout = useCallback(
    async () => {
      // Clear the Mixpanel identity so the next user on this device starts as a
      // fresh anonymous session and is never merged with the previous user.
      resetUser();
      await base44.auth.logout();
      setUser(null);
      setAuthError(null);
      await signOut({ redirectUrl: '/' });
    },
    [signOut],
  );

  const updateUserData = useCallback(async (data) => {
    const updated = await base44.auth.updateMyUserData(data);
    setUser(updated);
    return updated;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated,
        setIsAuthenticated: () => {},
        isLoadingAuth,
        authStalled,
        authChecked: isLoaded,
        checkUserAuth: () => {},
        isLoadingPublicSettings,
        authError,
        setAuthError,
        appPublicSettings,
        navigateToLogin,
        logout,
        updateUserData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;
