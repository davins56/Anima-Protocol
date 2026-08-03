import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function usePulseRealtimeDashboard(sessionId) {
  const [tension, setTension] = useState(0);
  const [headlines, setHeadlines] = useState([]);
  const [trendHistory, setTrendHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    
    // Initial load
    refreshPulse();
    
    // Subscribe to real-time updates
    const unsubscribe = base44.entities.WorldState.subscribe((event) => {
      if (event.data?.session_id === sessionId) {
        refreshPulse();
      }
    });

    return unsubscribe;
  }, [sessionId]);

  const refreshPulse = async () => {
    try {
      const [events, emotions] = await Promise.all([
        base44.entities.WorldState.filter(
          { session_id: sessionId, category: 'event' },
          '-created_date',
          15
        ),
        base44.entities.CharacterEmotionalState.filter(
          { session_id: sessionId, is_current: true },
          '-created_date',
          50
        ),
      ]);

      // Update headlines
      const newHeadlines = (events || []).map(e => ({
        id: e.id,
        title: e.subject,
        description: e.fact,
        timestamp: e.created_date,
        type: e.category,
      }));
      setHeadlines(newHeadlines);

      // Calculate tension
      const avgIntensity = emotions && emotions.length > 0
        ? emotions.reduce((sum, e) => sum + (e.intensity || 0), 0) / emotions.length
        : 0;
      setTension(Math.min(100, avgIntensity * 10));

      // Build trend
      const trend = (emotions || []).slice(0, 20).reverse().map((e, idx) => ({
        time: `T${idx}`,
        tension: e.intensity * 10,
      }));
      setTrendHistory(trend);

      setLoading(false);
    } catch (err) {
      console.error('Pulse refresh error:', err);
    }
  };

  return {
    tension,
    headlines,
    trendHistory,
    loading,
    refresh: refreshPulse,
  };
}