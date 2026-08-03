import { useState, useCallback } from 'react';
import { base44 } from '@/api/base44Client';

export function useCrossSessionMemory(characterId, sessionId) {
  const [memoryContext, setMemoryContext] = useState('');
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [memories, setMemories] = useState([]);

  // Build memory context for prompt injection
  const buildMemoryContext = useCallback(async () => {
    if (!characterId) return;
    setMemoryLoading(true);
    try {
      const result = await base44.functions.invoke('buildMemoryContext', {
        character_id: characterId,
        session_id: sessionId,
        include_all_memories: true,
      });
      if (result?.data?.context) {
        setMemoryContext(result.data.context);
        setMemories(result.data.memories_by_type || []);
      }
    } catch (err) {
      console.error('Failed to build memory context:', err);
    } finally {
      setMemoryLoading(false);
    }
  }, [characterId, sessionId]);

  // Form memories after session exchange
  const formMemoriesFromSession = useCallback(async (recentMessages, relatedCharacterId = null) => {
    if (!characterId || !sessionId || !recentMessages) return null;
    try {
      const result = await base44.functions.invoke('formCrossSessionMemory', {
        character_id: characterId,
        session_id: sessionId,
        related_character_id: relatedCharacterId,
        recent_messages: recentMessages,
      });
      return result?.data;
    } catch (err) {
      console.error('Failed to form memories:', err);
      return null;
    }
  }, [characterId, sessionId]);

  // Update memories with session outcomes
  const updateMemoriesFromSession = useCallback(async (relationshipChanges, newInteractions, emotionalDiscoveries) => {
    if (!characterId || !sessionId) return null;
    try {
      const result = await base44.functions.invoke('updateMemoryFromSession', {
        character_id: characterId,
        session_id: sessionId,
        relationship_changes: relationshipChanges || {},
        new_interactions: newInteractions || [],
        emotional_discoveries: emotionalDiscoveries || [],
      });
      return result?.data;
    } catch (err) {
      console.error('Failed to update memories:', err);
      return null;
    }
  }, [characterId, sessionId]);

  // Retrieve specific memories
  const retrieveMemories = useCallback(async (memoryTypes = null, relatedCharacterId = null) => {
    if (!characterId) return [];
    try {
      const result = await base44.functions.invoke('retrieveCrossSessionMemories', {
        character_id: characterId,
        related_character_id: relatedCharacterId,
        memory_types: memoryTypes,
        session_id: sessionId,
        limit: 10,
      });
      return result?.data?.memories || [];
    } catch (err) {
      console.error('Failed to retrieve memories:', err);
      return [];
    }
  }, [characterId, sessionId]);

  return {
    memoryContext,
    memoryLoading,
    memories,
    buildMemoryContext,
    formMemoriesFromSession,
    updateMemoriesFromSession,
    retrieveMemories,
  };
}