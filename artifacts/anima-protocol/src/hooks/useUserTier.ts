import { useUser } from '@clerk/react';   // ← Correct package name for your project
import { useEffect, useState } from 'react';

export function useUserTier() {
  const { user, isLoaded, isSignedIn } = useUser();
  const [isMax, setIsMax] = useState(false);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !user) {
      setIsMax(false);
      return;
    }

    const maxFromClerk =
      user.publicMetadata?.isMax === true ||
      user.publicMetadata?.serenityMax === true ||
      user.publicMetadata?.tier === 'max';

    setIsMax(!!maxFromClerk);
  }, [user, isLoaded, isSignedIn]);

  return { isMax, isLoaded };
}