import { useEffect, useState } from 'react';

// Optional: Try to import Clerk safely
let useUser: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const clerk = require('@clerk/clerk-react');
  useUser = clerk.useUser;
} catch (e) {
  // Clerk not available — use fallback for development
  console.warn('Clerk not found — using fallback tier system');
}

export function useUserTier() {
  const [isMax, setIsMax] = useState(false);
  const [isLoaded, setIsLoaded] = useState(true);

  // Clerk version (if available)
  useEffect(() => {
    if (!useUser) {
      // Fallback for development / testing
      setIsMax(true); // ← Change to false if you want to test non-Max
      setIsLoaded(true);
      return;
    }

    // Real Clerk version
    const { user, isLoaded: clerkLoaded, isSignedIn } = useUser();

    if (!clerkLoaded || !isSignedIn || !user) {
      setIsMax(false);
      return;
    }

    const maxFromClerk =
      user.publicMetadata?.isMax === true ||
      user.publicMetadata?.serenityMax === true ||
      user.publicMetadata?.tier === 'max';

    setIsMax(!!maxFromClerk);
  }, []);

  return { isMax, isLoaded };
}