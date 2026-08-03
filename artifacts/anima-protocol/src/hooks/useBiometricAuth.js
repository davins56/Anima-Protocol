import { useState, useCallback } from 'react';

export function useBiometricAuth() {
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [isSupported, setIsSupported] = useState(
    window.PublicKeyCredential !== undefined &&
    navigator.credentials !== undefined
  );

  const authenticate = useCallback(async () => {
    if (!isSupported) {
      throw new Error('Biometric authentication not supported on this device');
    }

    setIsAuthenticating(true);
    try {
      const challenge = new Uint8Array(32);
      crypto.getRandomValues(challenge);

      const assertion = await navigator.credentials.get({
        publicKey: {
          challenge,
          timeout: 60000,
          userVerification: 'preferred',
          rpId: window.location.hostname,
        },
        mediation: 'optional',
      });

      if (!assertion) {
        throw new Error('Authentication cancelled');
      }

      return true;
    } finally {
      setIsAuthenticating(false);
    }
  }, [isSupported]);

  return {
    authenticate,
    isAuthenticating,
    isSupported,
  };
}