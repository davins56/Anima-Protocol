import React, { createContext, useState, useContext, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings] = useState(null);

  useEffect(() => {
    base44.auth.isAuthenticated().then((authed) => {
      setIsAuthenticated(authed);
      if (authed) {
        base44.auth.me().then((me) => {
          setUser(me);
        }).catch((err) => setAuthError(err.message));
      }
    }).catch((err) => {
      setAuthError(err.message);
    }).finally(() => {
      setIsLoadingAuth(false);
    });
  }, []);

  const navigateToLogin = () => {
    window.location.href = '/landing';
  };

  const logout = async () => {
    await base44.auth.logout();
    setUser(null);
    setIsAuthenticated(false);
    setAuthError(null);
  };

  const updateUserData = async (data) => {
    const updated = await base44.auth.updateMyUserData(data);
    setUser(updated);
    return updated;
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        setUser,
        isAuthenticated,
        setIsAuthenticated,
        isLoadingAuth,
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
