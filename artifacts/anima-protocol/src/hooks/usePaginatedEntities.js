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
    queryKey: [entityName, 'paginated', currentPage],
    queryFn: async () => {
      const allData = await base44.entities[entityName].list(sortField, pageSize + skip);
      return {
        items: allData?.slice(skip, skip + pageSize) || [],
        total: allData?.length || 0,
        hasMore: allData?.length > skip + pageSize,
      };
    },
    staleTime: 60000, // 1m
  });

  return {
    items: data?.items || [],
    total: data?.total || 0,
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