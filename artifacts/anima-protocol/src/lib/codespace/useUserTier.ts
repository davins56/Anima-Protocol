import { useEffect, useState } from 'react';
import { useUser } from '@clerk/react';

export function useUserTier() {
  const [isMax, setIsMax] = useState(false);
  const { user, isLoaded, isSignedIn } = useUser();

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
  }, [isLoaded, isSignedIn, user]);

  return { isMax, isLoaded };
}