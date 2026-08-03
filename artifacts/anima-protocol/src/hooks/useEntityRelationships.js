// @ts-check
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * Loads an entity + related entities (e.g., character + relationships + inventory).
 * Batches related queries to reduce network calls.
 * @param {string} entityName
 * @param {string} entityId
 * @param {Record<string, any>} [relatedEntities]
 */
export function useEntityRelationships(entityName, entityId, relatedEntities = {}) {
  const { data, isLoading, error } = useQuery({
    queryKey: [entityName, entityId, 'relations'],
    queryFn: async () => {
      const result = { primary: null, related: {} };

      // Load primary entity
      if (entityId) {
        const primary = await base44.entities[entityName].list('-created_date', 200);
        result.primary = primary?.find(e => e.id === entityId);
      }

      // Batch load related entities in parallel
      const relatedQueries = Object.entries(relatedEntities).map(([key, { entityName: relName, filter }]) =>
        base44.entities[relName]
          .filter(filter || {}, '-created_date', 100)
          .then(data => ({ [key]: data || [] }))
          .catch(() => ({ [key]: [] }))
      );

      const relatedData = await Promise.all(relatedQueries);
      relatedData.forEach(obj => Object.assign(result.related, obj));

      return result;
    },
    enabled: !!entityId,
    staleTime: 45000, // 45s
  });

  return {
    primary: data?.primary || null,
    related: data?.related || {},
    isLoading,
    error,
  };
}