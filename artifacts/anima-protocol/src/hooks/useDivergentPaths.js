import { useState, useEffect, useRef } from 'react';
import { base44 } from '@/api/base44Client';

export const useDivergentPaths = (sessionId, characterId, characterName, messages) => {
  const [paths, setPaths] = useState([]);
  const [showPaths, setShowPaths] = useState(false);
  const [loading, setLoading] = useState(false);
  const messageCheckRef = useRef(0);

  const generatePaths = async () => {
    if (!sessionId || !characterId || !messages || messages.length < 2) return;

    setLoading(true);
    try {
      const result = await base44.functions.invoke('generateDivergentPaths', {
        session_id: sessionId,
        character_id: characterId,
        character_name: characterName,
        recent_messages: messages.slice(-8),
      });

      if (result?.data?.paths) {
        setPaths(result.data.paths);
        setShowPaths(true);
      }
    } catch (err) {
      console.error('Error generating paths:', err);
    } finally {
      setLoading(false);
    }
  };

  // Auto-trigger path generation after major exchanges
  useEffect(() => {
    if (!messages || messages.length < 2) return;

    const currentCount = messages.length;
    
    // Trigger every 2-3 messages (after a meaningful exchange)
    if (currentCount > messageCheckRef.current && currentCount % 3 === 0) {
      messageCheckRef.current = currentCount;
      
      // Check if last message is from AI (major dialogue)
      const lastMsg = messages[messages.length - 1];
      if (lastMsg?.role === 'assistant' && lastMsg?.character_name !== '__typing__') {
        setTimeout(() => generatePaths(), 500);
      }
    }
  }, [messages, sessionId, characterId]);

  const handleSelectPath = async (path) => {
    // Inject path selection as a narrative directive
    const pathDirective = `[NARRATIVE PATH SELECTED: ${path.title}]\nDirection: ${path.description}\nEmotional Arc: ${path.emotional_arc}`;
    
    // Let parent handle the message injection
    setShowPaths(false);
    setPaths([]);
    
    return pathDirective;
  };

  return {
    paths,
    showPaths,
    loading,
    generatePaths,
    handleSelectPath,
    setShowPaths,
  };
};