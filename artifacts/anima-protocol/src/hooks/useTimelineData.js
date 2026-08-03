import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useTimelineData(sessionId) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [sessions, setSessions] = useState({});

  useEffect(() => {
    if (!sessionId) return;
    loadTimelineData();
  }, [sessionId]);

  const loadTimelineData = async () => {
    setLoading(true);
    try {
      // Fetch all wiki entries for this session
      const wikiEntries = await base44.entities.WikiCodex.filter({
        session_ids: { $elemMatch: sessionId },
      }, '-mention_count', 200);

      // Prioritize events, but include other important entries
      const events = (wikiEntries || [])
        .sort((a, b) => {
          // Sort by: events first, then by mention count, then by importance
          const aIsEvent = a.entry_type === 'event' ? 0 : 1;
          const bIsEvent = b.entry_type === 'event' ? 0 : 1;
          if (aIsEvent !== bIsEvent) return aIsEvent - bIsEvent;
          
          const mentionDiff = (b.mention_count || 0) - (a.mention_count || 0);
          if (mentionDiff !== 0) return mentionDiff;
          
          const importanceOrder = { central: 0, major: 1, notable: 2, minor: 3 };
          return (importanceOrder[a.importance] || 3) - (importanceOrder[b.importance] || 3);
        });

      setEvents(events);

      // Load session metadata for quick reference
      const allSessions = await base44.entities.ChatSession.list('-created_date', 100);
      const sessionMap = {};
      (allSessions || []).forEach(s => {
        sessionMap[s.id] = {
          id: s.id,
          title: s.title,
          created: s.created_date,
        };
      });
      setSessions(sessionMap);
    } catch (err) {
      console.error('Error loading timeline data:', err);
    } finally {
      setLoading(false);
    }
  };

  return {
    events,
    loading,
    sessions,
    reload: loadTimelineData,
  };
}