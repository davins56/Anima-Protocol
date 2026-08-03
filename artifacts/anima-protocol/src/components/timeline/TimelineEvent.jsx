import { useState } from 'react';
import { motion } from 'framer-motion';
import { Calendar, MapPin, Users, BookOpen } from 'lucide-react';

const eventTypeColors = {
  event: 'border-yellow-400/30 bg-yellow-900/10',
  location: 'border-green-400/30 bg-green-900/10',
  character: 'border-cyan-400/30 bg-cyan-900/10',
  faction: 'border-orange-400/30 bg-orange-900/10',
  concept: 'border-pink-400/30 bg-pink-900/10',
  lore: 'border-primary/30 bg-primary/5',
};

const eventTypeIcons = {
  event: '⚡',
  location: '📍',
  character: '👤',
  faction: '🏛️',
  concept: '💡',
  lore: '📜',
};

export default function TimelineEvent({
  event,
  isSelected = false,
  onSelect,
  onNavigateToSession,
}) {
  const [expanded, setExpanded] = useState(isSelected);

  const timelinePosition = event.mention_count ? Math.min((event.mention_count / 20) * 100, 100) : 50;

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      className="relative"
    >
      {/* Timeline connector line */}
      <div className="absolute left-6 top-12 bottom-0 w-0.5 bg-gradient-to-b from-primary/30 to-transparent pointer-events-none" />

      {/* Timeline dot */}
      <div
        className={`absolute left-2 top-4 w-3 h-3 rounded-full border-2 cursor-pointer transition-all ${
          isSelected
            ? 'border-primary bg-primary scale-150'
            : 'border-primary/40 bg-primary/20 hover:scale-125'
        }`}
        onClick={() => onSelect?.(event)}
      />

      {/* Event card */}
      <motion.div
        onClick={() => {
          onSelect?.(event);
          setExpanded(!expanded);
        }}
        className={`ml-12 p-3 border rounded-lg cursor-pointer transition-all ${
          eventTypeColors[event.entry_type] || eventTypeColors.lore
        } ${isSelected ? 'ring-1 ring-primary/50' : 'hover:opacity-80'}`}
      >
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-lg flex-shrink-0">
                {eventTypeIcons[event.entry_type] || '📌'}
              </span>
              <p className="font-mono text-[9px] text-primary font-semibold tracking-wider uppercase truncate">
                {event.name}
              </p>
            </div>
            {event.summary && (
              <p className="text-[8px] text-primary/70 mt-1.5 line-clamp-2">{event.summary}</p>
            )}
          </div>
          <div className="flex items-center gap-1 flex-shrink-0 text-primary/50 text-[8px]">
            <span className="font-mono">{event.mention_count || 1}</span>
            <BookOpen className="w-3 h-3" />
          </div>
        </div>

        {/* Expanded Details */}
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-3 space-y-2 pt-3 border-t border-primary/10"
          >
            {/* Importance & Type */}
            <div className="grid grid-cols-2 gap-2 text-[8px]">
              {event.importance && (
                <div>
                  <span className="text-primary/50">Importance:</span>
                  <p className="text-primary/70 font-mono uppercase">{event.importance}</p>
                </div>
              )}
              <div>
                <span className="text-primary/50">Mentions:</span>
                <p className="text-primary/70 font-mono">{event.mention_count || 1}</p>
              </div>
            </div>

            {/* Sessions */}
            {event.session_ids?.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-primary/10">
                <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Sessions</p>
                <div className="space-y-1">
                  {event.session_ids.map((sessionId, idx) => (
                    <button
                      key={sessionId}
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToSession?.(sessionId);
                      }}
                      className="block w-full text-left text-[7px] px-2 py-1 bg-primary/10 border border-primary/20 text-primary/70 hover:text-primary hover:bg-primary/20 rounded transition-all font-mono"
                    >
                      Session {(idx + 1).toString().padStart(2, '0')} →
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Related Entries */}
            {event.related_entries?.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-primary/10">
                <p className="text-[8px] font-mono text-primary/50 tracking-widest uppercase">Related</p>
                <div className="flex flex-wrap gap-1">
                  {event.related_entries.slice(0, 3).map((name, idx) => (
                    <span
                      key={idx}
                      className="text-[7px] px-1.5 py-0.5 bg-primary/10 border border-primary/20 rounded text-primary/60"
                    >
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}