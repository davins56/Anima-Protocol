import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import InteractiveTimeline from '@/components/timeline/InteractiveTimeline';
import { BookOpen, Map, Users, Zap } from 'lucide-react';
import { motion } from 'framer-motion';

export default function TimelineDashboard() {
  const { sessionId } = useParams();
  const [selectedEvent, setSelectedEvent] = useState(null);

  const getEventStats = () => {
    if (!selectedEvent) {
      return {
        type: 'No event selected',
        mentions: 0,
        importance: 'N/A',
        sessions: 0,
      };
    }

    return {
      type: selectedEvent.entry_type,
      mentions: selectedEvent.mention_count || 1,
      importance: selectedEvent.importance || 'notable',
      sessions: selectedEvent.session_ids?.length || 0,
    };
  };

  const stats = getEventStats();

  return (
    <div className="flex-1 min-h-0 overflow-y-auto bg-background p-4 sm:p-6">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="font-sacred text-3xl sm:text-4xl text-primary tracking-wider">Timeline Dashboard</h1>
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase mt-2">
            Chronological narrative history
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-3 border border-primary/20 bg-black/40 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <Zap className="w-3 h-3 text-primary/50" />
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Type</p>
            </div>
            <p className="font-mono text-[9px] text-primary font-semibold uppercase">{stats.type}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="p-3 border border-primary/20 bg-black/40 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-3 h-3 text-primary/50" />
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Mentions</p>
            </div>
            <p className="font-mono text-[9px] text-primary font-semibold">{stats.mentions}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="p-3 border border-primary/20 bg-black/40 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <Map className="w-3 h-3 text-primary/50" />
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Importance</p>
            </div>
            <p className="font-mono text-[9px] text-primary font-semibold uppercase">{stats.importance}</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="p-3 border border-primary/20 bg-black/40 rounded-lg"
          >
            <div className="flex items-center gap-2 mb-1">
              <Users className="w-3 h-3 text-primary/50" />
              <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">Sessions</p>
            </div>
            <p className="font-mono text-[9px] text-primary font-semibold">{stats.sessions}</p>
          </motion.div>
        </div>

        {/* Main Timeline */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="h-[600px] border border-primary/20 bg-black/40 rounded-lg overflow-hidden"
        >
          <InteractiveTimeline
            sessionId={sessionId}
            onSelectEvent={setSelectedEvent}
          />
        </motion.div>

        {/* Selected Event Details */}
        {selectedEvent && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="p-4 border border-cyan-400/20 bg-cyan-900/10 rounded-lg space-y-3"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <h3 className="font-mono text-[10px] text-cyan-400 tracking-widest uppercase font-semibold">
                  {selectedEvent.name}
                </h3>
                {selectedEvent.summary && (
                  <p className="text-[8px] text-cyan-400/70 mt-2 leading-relaxed">{selectedEvent.summary}</p>
                )}
              </div>
            </div>

            {/* Tags */}
            {selectedEvent.tags?.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-cyan-400/10">
                <p className="text-[8px] font-mono text-cyan-400/50 tracking-widest uppercase">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {selectedEvent.tags.map((tag, idx) => (
                    <span key={idx} className="text-[7px] px-2 py-0.5 bg-cyan-400/10 border border-cyan-400/20 text-cyan-400/60 rounded">
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Facts */}
            {selectedEvent.lore_facts?.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-cyan-400/10">
                <p className="text-[8px] font-mono text-cyan-400/50 tracking-widest uppercase">Known Facts</p>
                <ul className="space-y-1">
                  {selectedEvent.lore_facts.map((fact, idx) => (
                    <li key={idx} className="text-[8px] text-cyan-400/70">• {fact}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Related Entries */}
            {selectedEvent.related_entries?.length > 0 && (
              <div className="space-y-1 pt-2 border-t border-cyan-400/10">
                <p className="text-[8px] font-mono text-cyan-400/50 tracking-widest uppercase">Related Entries</p>
                <div className="flex flex-wrap gap-1">
                  {selectedEvent.related_entries.map((name, idx) => (
                    <span key={idx} className="text-[7px] px-2 py-0.5 bg-cyan-400/10 border border-cyan-400/20 text-cyan-400/60 rounded">
                      {name}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </div>
  );
}