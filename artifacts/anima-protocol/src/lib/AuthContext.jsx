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
  startStoreSync,
  stopStoreSync,
} from '@/api/base44Client';

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
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

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
          if (!profile.display_name) {
            const preferred =
              clerkUser.firstName || clerkUser.fullName || clerkUser.username;
            if (preferred) {
              profile = await base44.auth.updateMe({ display_name: preferred });
            }
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
      base44.auth.clearSession();
      setUser(null);
    }

    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, clerkUser?.id]);

  const isAuthenticated = !!isSignedIn;
  const isLoadingAuth = !isLoaded;

  const navigateToLogin = useCallback(() => {
    navigate('/sign-in');
  }, [navigate]);

  // Clerk owns the session and the post-logout redirect. We always land
  // signed-out users on the public landing page ("/"), never the bare
  // sign-in screen.
  const logout = useCallback(
    async () => {
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
