import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useState } from 'react';

/**
 * Wraps entity list queries with automatic pagination.
 * Loads 50 per page by default, loads more on demand.
 */
export function usePaginatedEntities(entityName, pageSize = 50, sortField = '-created_date') {
  const [currentPage, setCurrentPage] = useState(0);
  const skip = currentPage * pageSize;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [entityName, 'paginated', currentPage, pageSize, sortField],
    queryFn: async () => {
      // Fetch only this page's rows via a real SQL offset, plus one extra row to
      // tell whether another page exists — so paging deep into history never
      // loads every preceding row into memory.
      const rows = await base44.entities[entityName].list(sortField, pageSize + 1, {
        offset: skip,
      });
      const list = rows || [];
      return {
        items: list.slice(0, pageSize),
        hasMore: list.length > pageSize,
      };
    },
    staleTime: 60000, // 1m
  });

  return {
    items: data?.items || [],
    hasMore: data?.hasMore || false,
    currentPage,
    goToPage: setCurrentPage,
    nextPage: () => setCurrentPage(p => p + 1),
    prevPage: () => setCurrentPage(p => Math.max(0, p - 1)),
    isLoading,
    error,
    refetch,
  };
}