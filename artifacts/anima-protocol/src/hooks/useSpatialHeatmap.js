import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useSpatialHeatmap(sessionId) {
  const [locations, setLocations] = useState([]);
  const [intensities, setIntensities] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    calculateHeatmap();
  }, [sessionId]);

  const calculateHeatmap = async () => {
    setLoading(true);
    try {
      const [locs, worldState, quests, emotions] = await Promise.all([
        base44.entities.Location.list('-created_date', 100),
        base44.entities.WorldState.filter({ session_id: sessionId }, '-created_date', 100),
        base44.entities.Quest.filter({ session_id: sessionId }, '-created_date', 100),
        base44.entities.CharacterEmotionalState.filter({ session_id: sessionId, is_current: true }, '-created_date', 50),
      ]);

      setLocations(locs || []);

      const intensityMap = {};

      (locs || []).forEach(loc => {
        const locName = loc.name?.toLowerCase() || '';

        // Conflict: events + high emotions
        const conflictEvents = (worldState || []).filter(w =>
          w.subject?.toLowerCase().includes(locName) && w.category === 'conflict'
        ).length;
        const conflict = Math.min(100, conflictEvents * 15);

        // Activity: recent events + character presence
        const activity = Math.min(
          100,
          ((worldState || []).filter(w => w.subject?.toLowerCase().includes(locName)).length * 10) +
          (emotions || []).filter(e => e.intensity >= 7).length * 5
        );

        // Quests: available quests + unvisited
        const quests_score = Math.min(
          100,
          (quests || []).filter(q => q.status === 'available').length * 15 + (loc.visited ? 0 : 30)
        );

        intensityMap[loc.id] = {
          conflict,
          activity,
          quests: quests_score,
          overall: (conflict * 0.35) + (activity * 0.35) + (quests_score * 0.30),
          x: loc.x_coord || 50,
          y: loc.y_coord || 50,
        };
      });

      setIntensities(intensityMap);
    } catch (err) {
      console.error('Heatmap calculation error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getHotspots = (layer = 'overall', threshold = 60) => {
    return Object.entries(intensities)
      .filter(([_, data]) => data[layer] >= threshold)
      .sort((a, b) => b[1][layer] - a[1][layer]);
  };

  return {
    locations,
    intensities,
    loading,
    getHotspots,
    recalculate: calculateHeatmap,
  };
}