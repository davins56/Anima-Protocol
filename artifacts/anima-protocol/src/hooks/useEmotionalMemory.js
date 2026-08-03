import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

export function useEmotionalMemory(sessionId, characterId) {
  const [memories, setMemories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId || !characterId) {
      setLoading(false);
      return;
    }
    loadMemories();
  }, [sessionId, characterId]);

  const loadMemories = async () => {
    try {
      // Load cross-session memories for this character
      const data = await base44.entities.CrossSessionMemory.filter({
        character_id: characterId,
      }, '-reinforcement_count', 20);

      setMemories(data || []);
    } catch (err) {
      console.warn('Failed to load emotional memories:', err);
    } finally {
      setLoading(false);
    }
  };

  const recordMemory = async (memoryData) => {
    try {
      await base44.functions.invoke('formCrossSessionMemory', {
        character_id: characterId,
        session_id: sessionId,
        ...memoryData,
      });
      await loadMemories();
    } catch (err) {
      console.error('Failed to record memory:', err);
    }
  };

  const recordBirthday = async (date) => {
    try {
      const user = await base44.auth.me();
      await base44.auth.updateMe({
        settings: {
          ...user.settings,
          companion_birthday: date,
        },
      });
    } catch (err) {
      console.error('Failed to record birthday:', err);
    }
  };

  const buildMemoryContext = () => {
    if (!memories.length) return '';

    const lines = memories
      .sort((a, b) => b.reinforcement_count - a.reinforcement_count)
      .slice(0, 10)
      .map((mem) => {
        const emphasize = mem.emotional_weight > 7 ? '***' : '';
        return `${emphasize}[${mem.memory_type}] ${mem.subject}: ${mem.description}${emphasize}`;
      });

    return `PERSISTENT MEMORIES (across all conversations):\n${lines.join('\n')}\n`;
  };

  return {
    memories,
    loading,
    recordMemory,
    recordBirthday,
    buildMemoryContext,
    refresh: loadMemories,
  };
}