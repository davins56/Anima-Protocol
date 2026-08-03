// @ts-check
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Batches user data + entity counts in a single query.
 * Prevents N+1 queries on pages that need user + stats.
 */
export function usePageStats() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['pageStats'],
    queryFn: async () => {
      const [user, sessions, chars] = await Promise.all([
        base44.auth.me(),
        base44.entities.ChatSession.list('-updated_date', 1),
        base44.entities.Character.list('-created_date', 1),
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