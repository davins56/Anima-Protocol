import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useVectorMemorySystem(characterId) {
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [relationships, setRelationships] = useState({});
  const [loading, setLoading] = useState(false);

  // Create a vector memory from session events
  const createMemory = useCallback(
    async (sessionId, memoryType, title, content, options = {}) => {
      if (!characterId) return null;
      try {
        const result = await base44.functions.invoke('createVectorMemory', {
          character_id: characterId,
          session_id: sessionId,
          memory_type: memoryType,
          title,
          content,
          related_characters: options.relatedCharacters,
          related_events: options.relatedEvents,
          emotional_signature: options.emotionalSignature,
          relationship_deltas: options.relationshipDeltas,
          narrative_significance: options.significance,
        });
        return result?.data?.memory;
      } catch (err) {
        console.error('Memory creation failed:', err);
        return null;
      }
    },
    [characterId]
  );

  // Search memories by semantic similarity
  const searchMemories = useCallback(
    async (query, options = {}) => {
      if (!characterId) return [];
      setSearching(true);
      try {
        const result = await base44.functions.invoke('vectorMemorySearch', {
          character_id: characterId,
          query,
          memory_types: options.memoryTypes,
          related_character_id: options.relatedCharacterId,
          limit: options.limit || 8,
          similarity_threshold: options.threshold || 0.5,
        });
        const memories = result?.data?.memories || [];
        setSearchResults(memories);
        return memories;
      } catch (err) {
        console.error('Memory search failed:', err);
        return [];
      } finally {
        setSearching(false);
      }
    },
    [characterId]
  );

  // Evolve a relationship based on session events
  const evolveRelationship = useCallback(
    async (characterBId, sessionId, scoreDelta, options = {}) => {
      if (!characterId) return null;
      try {
        const result = await base44.functions.invoke('evolveRelationshipHistory', {
          character_a_id: characterId,
          character_b_id: characterBId,
          session_id: sessionId,
          score_delta: scoreDelta,
          catalyst_event: options.catalyst,
          shared_memory_id: options.memoryId,
          emotional_context: options.context,
        });
        return result?.data?.relationship;
      } catch (err) {
        console.error('Relationship evolution failed:', err);
        return null;
      }
    },
    [characterId]
  );

  // Get rich narrative of a relationship
  const getRelationshipNarrative = useCallback(async (characterBId) => {
    if (!characterId) return null;
    setLoading(true);
    try {
      const result = await base44.functions.invoke('getRelationshipNarrative', {
        character_a_id: characterId,
        character_b_id: characterBId,
      });
      if (result?.data?.narrative) {
        setRelationships(prev => ({
          ...prev,
          [characterBId]: result.data,
        }));
        return result.data;
      }
    } catch (err) {
      console.error('Narrative retrieval failed:', err);
    } finally {
      setLoading(false);
    }
    return null;
  }, [characterId]);

  // Batch retrieve multiple relationships
  const loadRelationshipHistories = useCallback(async (characterIds) => {
    const narratives = {};
    for (const charId of characterIds) {
      const narrative = await getRelationshipNarrative(charId);
      if (narrative) {
        narratives[charId] = narrative;
      }
    }
    return narratives;
  }, [getRelationshipNarrative]);

  return {
    // Memory operations
    createMemory,
    searchMemories,
    searchResults,
    searching,

    // Relationship operations
    evolveRelationship,
    getRelationshipNarrative,
    loadRelationshipHistories,
    relationships,
    loading,
  };
}