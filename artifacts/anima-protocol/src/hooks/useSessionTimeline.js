import { useEffect, useState } from 'react';
import { base44 } from '@/api/base44Client';

export function useSessionTimeline(sessionId) {
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) {
      setLoading(false);
      return;
    }

    const fetchTimeline = async () => {
      try {
        const [worldStates, relationships, quests, emotionalStates, memories] = await Promise.all([
          base44.entities.WorldState.filter({ session_id: sessionId }, '-created_date', 100),
          base44.entities.CharacterRelationship.filter({ session_id: sessionId }, '-created_date', 100),
          base44.entities.Quest.filter({ session_id: sessionId }, '-created_date', 100),
          base44.entities.CharacterEmotionalState.filter({ session_id: sessionId }, '-created_date', 100),
          base44.entities.VectorMemory.filter({ session_id: sessionId }, '-created_date', 100),
        ]);

        // Build timeline events
        const timelineEvents = [];

        // Add world state events
        (worldStates || []).forEach(ws => {
          timelineEvents.push({
            id: `world-${ws.id}`,
            type: 'world_event',
            timestamp: new Date(ws.created_date),
            title: ws.subject || 'World Change',
            content: ws.fact,
            category: ws.category || 'lore',
            icon: '🌍',
            data: ws,
          });
        });

        // Add relationship milestones
        (relationships || []).forEach(rel => {
          if (rel.last_interaction) {
            timelineEvents.push({
              id: `rel-${rel.id}`,
              type: 'relationship',
              timestamp: new Date(rel.last_interaction),
              title: `${rel.character_a_name} & ${rel.character_b_name}`,
              content: `Relationship: ${rel.tier} (${rel.score}/100)`,
              category: rel.tier,
              icon: rel.score > 50 ? '❤️' : rel.score > 0 ? '🤝' : '⚔️',
              data: rel,
            });
          }
        });

        // Add quest milestones
        (quests || []).forEach(quest => {
          if (quest.completed_at) {
            timelineEvents.push({
              id: `quest-${quest.id}`,
              type: 'quest',
              timestamp: new Date(quest.completed_at),
              title: quest.title,
              content: `Quest: ${quest.status}`,
              category: quest.difficulty,
              icon: '⚔️',
              data: quest,
            });
          }
          if (quest.started_at) {
            timelineEvents.push({
              id: `quest-start-${quest.id}`,
              type: 'quest_start',
              timestamp: new Date(quest.started_at),
              title: `${quest.title} started`,
              content: `Difficulty: ${quest.difficulty}`,
              category: 'quest',
              icon: '📜',
              data: quest,
            });
          }
        });

        // Add emotional state changes
        (emotionalStates || []).forEach(state => {
          timelineEvents.push({
            id: `emotion-${state.id}`,
            type: 'emotion',
            timestamp: new Date(state.created_date),
            title: `${state.character_name}'s Emotion`,
            content: `${state.primary_emotion} (intensity: ${state.intensity}/10)${state.trigger ? ` - ${state.trigger}` : ''}`,
            category: state.primary_emotion,
            icon: getEmotionIcon(state.primary_emotion),
            data: state,
          });
        });

        // Add memory milestones
        (memories || []).forEach(mem => {
          timelineEvents.push({
            id: `memory-${mem.id}`,
            type: 'memory',
            timestamp: new Date(mem.created_date),
            title: mem.title || mem.memory_type.replace(/_/g, ' '),
            content: mem.content?.slice(0, 150) || mem.description?.slice(0, 150),
            category: mem.memory_type,
            icon: '💭',
            data: mem,
          });
        });

        // Sort by timestamp descending (newest first)
        timelineEvents.sort((a, b) => b.timestamp - a.timestamp);

        setEvents(timelineEvents);
      } catch (err) {
        console.error('Timeline fetch error:', err);
        setEvents([]);
      } finally {
        setLoading(false);
      }
    };

    fetchTimeline();
  }, [sessionId]);

  return { events, loading };
}

function getEmotionIcon(emotion) {
  const icons = {
    joyful: '😊',
    calm: '😌',
    sad: '😢',
    angry: '😠',
    afraid: '😨',
    disgusted: '🤢',
    surprised: '😲',
    hopeful: '🌟',
    conflicted: '🤔',
    desperate: '😩',
    peaceful: '☮️',
  };
  return icons[emotion] || '😐';
}