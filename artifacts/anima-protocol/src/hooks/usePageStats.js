// @ts-check
import { useQuery } from '@tanstack/react-query';
import { animaClient } from '@/api/animaClient';

/**
 * Batches user data + entity counts in a single query.
 * Prevents N+1 queries on pages that need user + stats.
 */
export function usePageStats() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pageStats'],
    queryFn: async () => {
      const [user, sessions, chars] = await Promise.all([
        animaClient.auth.me(),
        animaClient.entities.ChatSession.list('-updated_date', 1),
        animaClient.entities.Character.list('-created_date', 1),
      ]);

      return {
        user,
        sessionCount: sessions?.length || 0,
        charCount: chars?.length || 0,
      };
    },
    staleTime: 30000, // 30s
  });

  return {
    user: data?.user || null,
    sessionCount: data?.sessionCount || 0,
    charCount: data?.charCount || 0,
    isLoading,
    error,
  };
}