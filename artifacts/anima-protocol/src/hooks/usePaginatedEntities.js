// @ts-check
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { useEffect, useState } from 'react';

/**
 * Wraps entity list queries with automatic pagination.
 * Loads 50 per page by default, loads more on demand.
 * @param {string} entityName
 * @param {number} [pageSize]
 * @param {string} [sortField]
 * @param {import('@/api/base44Client').ListOptions} [listOpts]
 *   Extra list options merged into every page request (e.g.
 *   `{ withMessages: false }` for metadata-only ChatSession sidebars, or
 *   `{ filters, search }` to scope/search the whole list server-side). `offset`
 *   is always supplied by the hook and cannot be overridden here. Changing these
 *   options resets paging back to the first page so a new filter/search never
 *   strands the user on an out-of-range page.
 * @param {{ countTotal?: boolean }} [options]
 *   `countTotal: true` runs an extra cheap COUNT(*) (same filters/search, no
 *   limit/offset) so the hook can expose a grand `total` and `pageCount`,
 *   enabling "jump to page N" / Last-page pagers. Off by default so the many
 *   prev/next-only callers (sidebars) don't pay for a count they don't show.
 */
export function usePaginatedEntities(
  entityName,
  pageSize = 50,
  sortField = '-created_date',
  listOpts,
  options,
) {
  const countTotal = Boolean(options && options.countTotal);
  const [currentPage, setCurrentPage] = useState(0);
  const skip = currentPage * pageSize;
  // Stable key for the extra options so the query refetches when they change but
  // not on every render (object identity would otherwise churn the query key).
  const optsKey = JSON.stringify(listOpts || {});

  // A changed filter/search (or sort) shrinks the result set, so snap back to
  // page 0 — otherwise the user could be left looking at an empty later page.
  useEffect(() => {
    setCurrentPage(0);
  }, [optsKey, sortField, pageSize]);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: [entityName, 'paginated', currentPage, pageSize, sortField, optsKey],
    queryFn: async () => {
      // Fetch only this page's rows via a real SQL offset, plus one extra row to
      // tell whether another page exists — so paging deep into history never
      // loads every preceding row into memory.
      const rows = await base44.entities[entityName].list(sortField, pageSize + 1, {
        ...(listOpts || {}),
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

  // Grand total (opt-in): one COUNT(*) over the same filters/search powers the
  // page-count and the jump/last controls. Keyed only by the filters/search
  // (not the current page) so flipping pages reuses the cached total.
  const { filters: countFilters, search: countSearch } = listOpts || {};
  const { data: total } = useQuery({
    queryKey: [entityName, 'count', JSON.stringify({ f: countFilters, s: countSearch })],
    queryFn: () => base44.entities[entityName].count({ filters: countFilters, search: countSearch }),
    enabled: countTotal,
    staleTime: 60000, // 1m
  });

  const pageCount =
    countTotal && typeof total === 'number'
      ? Math.max(1, Math.ceil(total / pageSize))
      : null;

  // Clamp jumps into range when a page count is known so a stale "last page"
  // tap (after rows were deleted) can never strand the user past the end.
  const goToPage = (/** @type {number} */ page) => {
    const target = Math.max(0, Math.floor(Number(page) || 0));
    setCurrentPage(pageCount != null ? Math.min(target, pageCount - 1) : target);
  };

  return {
    items: data?.items || [],
    hasMore: data?.hasMore || false,
    currentPage,
    total: typeof total === 'number' ? total : null,
    pageCount,
    goToPage,
    nextPage: () => setCurrentPage(p => p + 1),
    prevPage: () => setCurrentPage(p => Math.max(0, p - 1)),
    isLoading,
    error,
    refetch,
  };
}