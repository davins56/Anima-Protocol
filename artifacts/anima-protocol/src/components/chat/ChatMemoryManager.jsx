import { useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

/**
 * Manages memory formation and integration for chat sessions
 * Non-rendering utility component that handles memory lifecycle
 */
export default function ChatMemoryManager({
  characterId,
  sessionId,
  messages,
  relationships,
  characterEmotions,
  onMemoryContextReady = () => {},
}) {
  const memoryFormationIntervalRef = useRef(null);
  const lastFormationIndexRef = useRef(0);

  // Form memories periodically (every 5-6 messages)
  useEffect(() => {
    if (!characterId || !sessionId || !messages || messages.length < 3) return;

    const currentMessageCount = messages.length;

    // Check if we should form memories (every 5+ new messages)
    if (currentMessageCount - lastFormationIndexRef.current >= 5) {
      const recentMessages = messages.slice(-8);
      
      base44.functions
        .invoke('formCrossSessionMemory', {
          character_id: characterId,
          session_id: sessionId,
          recent_messages: recentMessages,
        })
        .catch((err) => console.error('Memory formation error:', err));

      lastFormationIndexRef.current = currentMessageCount;
    }
  }, [characterId, sessionId, messages]);

  // Load memory context on mount and pass to parent
  useEffect(() => {
    if (!characterId || !sessionId) return;

    const loadMemoryContext = async () => {
      try {
        const result = await base44.functions.invoke('buildMemoryContext', {
          character_id: characterId,
          session_id: sessionId,
          include_all_memories: true,
        });

        if (result?.data?.context) {
          onMemoryContextReady(result.data.context);
        }
      } catch (err) {
        console.error('Failed to load memory context:', err);
      }
    };

    loadMemoryContext();
  }, [characterId, sessionId, onMemoryContextReady]);

  // Update memories at session end based on relationship/emotion changes
  const sessionEndMemoryUpdate = async () => {
    if (!characterId || !sessionId || !messages || messages.length === 0) return;

    try {
      // Extract interaction pairs from messages
      const interactions = messages
        .slice(-10)
        .map((m) => `${m.character_name || 'User'}: ${m.content}`)
        .join('\n');

      // Get relationship deltas
      const relationshipChanges = Object.entries(relationships || {}).reduce((acc, [charId, rel]) => {
        acc[charId] = (rel?.score || 0);
        return acc;
      }, {});

      // Get emotional discoveries
      const emotionalDiscoveries = Object.entries(characterEmotions || {})
        .filter(([charId]) => charId === characterId)
        .map(([_, emotion]) => ({
          discovery: emotion?.emotion,
          description: `Experienced ${emotion?.emotion} with intensity ${emotion?.intensity || 5}`,
          intensity: emotion?.intensity || 5,
          tags: [emotion?.emotion, 'emotional-discovery'],
        }));

      await base44.functions.invoke('updateMemoryFromSession', {
        character_id: characterId,
        session_id: sessionId,
        relationship_changes: relationshipChanges,
        new_interactions: [interactions],
        emotional_discoveries: emotionalDiscoveries,
      });
    } catch (err) {
      console.error('Failed to update session memories:', err);
    }
  };

  // Expose session end update via window for manual calling
  useEffect(() => {
    if (typeof window !== 'undefined') {
      window._updateSessionMemories = sessionEndMemoryUpdate;
    }
    return () => {
      if (typeof window !== 'undefined') {
        delete window._updateSessionMemories;
      }
    };
  }, [characterId, sessionId, messages, relationships, characterEmotions]);

  return null; // Non-rendering component
}