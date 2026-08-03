import { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';

export function useStoryTimeline(sessionId) {
  const [milestones, setMilestones] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    if (!sessionId) return;
    loadTimeline();
  }, [sessionId]);

  const loadTimeline = async () => {
    setLoading(true);
    try {
      const [snapshots, memories] = await Promise.all([
        base44.entities.WorldSnapshot.filter(
          { session_id: sessionId, is_active: true },
          'created_date',
          100
        ),
        base44.entities.VectorMemory.filter(
          { session_id: sessionId },
          'created_date',
          100
        ),
      ]);

      const combined = [];

      (snapshots || []).forEach(snapshot => {
        combined.push({
          id: `snapshot-${snapshot.id}`,
          type: 'plot_development',
          title: snapshot.branch_name,
          description: snapshot.decision_point,
          timestamp: snapshot.created_date,
          source: 'snapshot',
        });
      });

      (memories || []).forEach(memory => {
        combined.push({
          id: `memory-${memory.id}`,
          type: memory.memory_type,
          title: memory.title,
          description: memory.content,
          timestamp: memory.created_date,
          source: 'memory',
        });
      });

      combined.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      setMilestones(combined);
    } catch (err) {
      console.error('Timeline loading error:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredMilestones = filter === 'all'
    ? milestones
    : milestones.filter(m => m.type === filter);

  return {
    milestones,
    filteredMilestones,
    loading,
    filter,
    setFilter,
    reload: loadTimeline,
  };
}