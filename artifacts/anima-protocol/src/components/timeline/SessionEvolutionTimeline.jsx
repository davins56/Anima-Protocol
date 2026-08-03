import { useState } from 'react';
import { ChevronDown, Filter } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSessionTimeline } from '@/hooks/useSessionTimeline';

export default function SessionEvolutionTimeline({ sessionId }) {
  const { events, loading } = useSessionTimeline(sessionId);
  const [expandedId, setExpandedId] = useState(null);
  const [filter, setFilter] = useState('all');

  const eventTypeColors = {
    world_event: 'border-green-400 bg-green-400/10',
    relationship: 'border-pink-400 bg-pink-400/10',
    quest: 'border-yellow-400 bg-yellow-400/10',
    quest_start: 'border-yellow-400/60 bg-yellow-400/5',
    emotion: 'border-purple-400 bg-purple-400/10',
    memory: 'border-cyan-400 bg-cyan-400/10',
  };

  const eventTypeLabels = {
    world_event: 'World Event',
    relationship: 'Relationship',
    quest: 'Quest Completed',
    quest_start: 'Quest Started',
    emotion: 'Emotional State',
    memory: 'Memory',
  };

  const filteredEvents = filter === 'all' 
    ? events 
    : events.filter(e => e.type === filter);

  if (loading) {
    return (
      <div className="p-4 border border-primary/15 bg-black/30 rounded space-y-2 animate-pulse">
        <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Loading timeline...</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-6 border border-primary/15 bg-black/30 rounded text-center">
        <p className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">No events yet</p>
        <p className="text-[10px] text-primary/20 mt-2">Interact with characters to build history</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 border border-primary/15 bg-black/30 rounded overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-primary/10 bg-black/60 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
            Timeline ({filteredEvents.length} events)
          </span>
          <div className="text-[9px] font-mono text-primary/40">
            {events.length} total
          </div>
        </div>

        {/* Filter buttons */}
        <div className="flex gap-1 flex-wrap">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-1 text-[8px] font-mono tracking-widest uppercase border rounded transition-all ${
              filter === 'all'
                ? 'border-primary/50 bg-primary/10 text-primary'
                : 'border-primary/15 bg-black/50 text-primary/30 hover:text-primary/60'
            }`}
          >
            All
          </button>
          {[
            { type: 'world_event', label: '🌍' },
            { type: 'relationship', label: '❤️' },
            { type: 'quest', label: '⚔️' },
            { type: 'emotion', label: '😊' },
            { type: 'memory', label: '💭' },
          ].map(({ type, label }) => (
            <button
              key={type}
              onClick={() => setFilter(type)}
              title={eventTypeLabels[type]}
              className={`px-2 py-1 text-xs font-mono border rounded transition-all ${
                filter === type
                  ? `${eventTypeColors[type]} border-current`
                  : 'border-primary/15 bg-black/50 text-primary/30 hover:text-primary/60'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Timeline */}
      <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
        {filteredEvents.length === 0 ? (
          <p className="text-center text-[9px] text-primary/30 py-6">No events in this category</p>
        ) : (
          filteredEvents.map((event, idx) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className="relative"
            >
              {/* Timeline dot and line */}
              <div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/30 to-primary/5" />
              <div className={`absolute left-2 top-2 w-3 h-3 rounded-full border-2 ${eventTypeColors[event.type]}`} />

              {/* Event card */}
              <button
                onClick={() => setExpandedId(expandedId === event.id ? null : event.id)}
                className={`w-full text-left pl-8 pr-3 py-2.5 border rounded transition-all hover:brightness-110 ${eventTypeColors[event.type]}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5">
                      <span className="text-lg">{event.icon}</span>
                      <span className="font-mono text-[9px] text-primary/50 tracking-widest uppercase flex-shrink-0">
                        {eventTypeLabels[event.type]}
                      </span>
                    </div>
                    <p className="font-mono text-[10px] text-primary/90 font-semibold truncate">
                      {event.title}
                    </p>
                    <p className="font-mono text-[8px] text-primary/60 mt-0.5 line-clamp-2">
                      {event.content}
                    </p>
                    <p className="font-mono text-[7px] text-primary/30 mt-1">
                      {event.timestamp.toLocaleDateString()} {event.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                  {event.data && (
                    <ChevronDown
                      className={`w-4 h-4 text-primary/40 flex-shrink-0 mt-0.5 transition-transform ${
                        expandedId === event.id ? 'rotate-180' : ''
                      }`}
                    />
                  )}
                </div>

                {/* Expanded details */}
                <AnimatePresence>
                  {expandedId === event.id && event.data && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="pt-2 mt-2 border-t border-current/30 space-y-1.5"
                    >
                      {event.type === 'relationship' && (
                        <div className="space-y-1 text-[8px] font-mono text-primary/70">
                          <p>Score: {event.data.score}/100</p>
                          <p>Tier: {event.data.tier}</p>
                          {event.data.relationship_arc && <p>Arc: {event.data.relationship_arc}</p>}
                          <p>Interactions: {event.data.interaction_count}</p>
                        </div>
                      )}
                      {event.type === 'quest' && (
                        <div className="space-y-1 text-[8px] font-mono text-primary/70">
                          <p>Status: {event.data.status}</p>
                          <p>Difficulty: {event.data.difficulty}</p>
                          {event.data.description && (
                            <p>{event.data.description.slice(0, 100)}...</p>
                          )}
                        </div>
                      )}
                      {event.type === 'emotion' && (
                        <div className="space-y-1 text-[8px] font-mono text-primary/70">
                          <p>Primary: {event.data.primary_emotion}</p>
                          {event.data.secondary_emotion && (
                            <p>Secondary: {event.data.secondary_emotion}</p>
                          )}
                          <p>Intensity: {event.data.intensity}/10</p>
                          {event.data.trigger && <p>Trigger: {event.data.trigger}</p>}
                        </div>
                      )}
                      {event.type === 'memory' && (
                        <div className="space-y-1 text-[8px] font-mono text-primary/70">
                          <p>Type: {event.data.memory_type.replace(/_/g, ' ')}</p>
                          {event.data.emotional_signature?.primary_emotion && (
                            <p>Emotion: {event.data.emotional_signature.primary_emotion} (intensity: {event.data.emotional_signature.intensity})</p>
                          )}
                          <p>Significance: {Math.round(event.data.narrative_significance * 100)}%</p>
                        </div>
                      )}
                      {event.type === 'world_event' && (
                        <div className="space-y-1 text-[8px] font-mono text-primary/70">
                          <p>Category: {event.data.category}</p>
                          {event.data.importance && <p>Importance: {event.data.importance}</p>}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </button>
            </motion.div>
          ))
        )}
      </div>

      {/* Summary stats */}
      {events.length > 0 && (
        <div className="p-3 border-t border-primary/10 bg-black/60 grid grid-cols-5 gap-2 text-[8px] font-mono">
          <div>
            <p className="text-primary/40 tracking-widest uppercase">Total</p>
            <p className="text-primary text-sm font-bold">{events.length}</p>
          </div>
          <div>
            <p className="text-primary/40 tracking-widest uppercase">World</p>
            <p className="text-green-400 text-sm font-bold">{events.filter(e => e.type === 'world_event').length}</p>
          </div>
          <div>
            <p className="text-primary/40 tracking-widest uppercase">Relations</p>
            <p className="text-pink-400 text-sm font-bold">{events.filter(e => e.type === 'relationship').length}</p>
          </div>
          <div>
            <p className="text-primary/40 tracking-widest uppercase">Quests</p>
            <p className="text-yellow-400 text-sm font-bold">{events.filter(e => e.type === 'quest' || e.type === 'quest_start').length}</p>
          </div>
          <div>
            <p className="text-primary/40 tracking-widest uppercase">Memories</p>
            <p className="text-cyan-400 text-sm font-bold">{events.filter(e => e.type === 'memory').length}</p>
          </div>
        </div>
      )}
    </div>
  );
}