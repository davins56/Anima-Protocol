import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTimelineData } from '@/hooks/useTimelineData';
import TimelineEvent from './TimelineEvent';
import { Search, Filter, Loader, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const ENTRY_TYPES = ['event', 'location', 'character', 'faction', 'concept', 'lore'];

export default function InteractiveTimeline({
  sessionId,
  onSelectEvent,
}) {
  const navigate = useNavigate();
  const { events, loading, sessions } = useTimelineData(sessionId);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [search, setSearch] = useState('');
  const [selectedType, setSelectedType] = useState('all');
  const [selectedImportance, setSelectedImportance] = useState('all');
  const timelineRef = useRef(null);

  const filteredEvents = events.filter(event => {
    const searchMatch = !search || event.name.toLowerCase().includes(search.toLowerCase());
    const typeMatch = selectedType === 'all' || event.entry_type === selectedType;
    const importanceMatch = selectedImportance === 'all' || event.importance === selectedImportance;
    return searchMatch && typeMatch && importanceMatch;
  });

  const scrollToEvent = (event) => {
    setSelectedEvent(event);
    onSelectEvent?.(event);
    
    // Scroll the timeline to show selected event
    if (timelineRef.current) {
      const element = timelineRef.current.querySelector(`[data-event-id="${event.id}"]`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  };

  const handleNavigateToSession = (sessionId) => {
    navigate(`/chat/${sessionId}`);
  };

  return (
    <div className="space-y-4 p-4 border border-primary/20 bg-black/40 rounded-lg h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase">
          Timeline ({filteredEvents.length})
        </h2>
      </div>

      {/* Search & Filters */}
      <div className="space-y-2 flex-shrink-0">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-primary/30" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-[8px] pl-7 pr-3 py-1.5 focus:outline-none focus:border-primary/50 transition-colors rounded"
          />
        </div>

        {/* Filter Controls */}
        <div className="flex gap-1 flex-wrap">
          <select
            value={selectedType}
            onChange={e => setSelectedType(e.target.value)}
            className="text-[7px] font-mono px-2 py-0.5 bg-black/60 border border-primary/20 text-primary/70 focus:outline-none focus:border-primary/50 rounded"
          >
            <option value="all">All Types</option>
            {ENTRY_TYPES.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <select
            value={selectedImportance}
            onChange={e => setSelectedImportance(e.target.value)}
            className="text-[7px] font-mono px-2 py-0.5 bg-black/60 border border-primary/20 text-primary/70 focus:outline-none focus:border-primary/50 rounded"
          >
            <option value="all">All Importance</option>
            <option value="central">Central</option>
            <option value="major">Major</option>
            <option value="notable">Notable</option>
            <option value="minor">Minor</option>
          </select>
        </div>
      </div>

      {/* Timeline Container */}
      <div
        ref={timelineRef}
        className="flex-1 overflow-y-auto space-y-4 min-h-0 pr-2"
        style={{ scrollBehavior: 'smooth' }}
      >
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader className="w-4 h-4 text-primary/40 animate-spin" />
          </div>
        ) : filteredEvents.length > 0 ? (
          <AnimatePresence>
            {filteredEvents.map((event, idx) => (
              <div key={event.id} data-event-id={event.id}>
                <TimelineEvent
                  event={event}
                  isSelected={selectedEvent?.id === event.id}
                  onSelect={scrollToEvent}
                  onNavigateToSession={handleNavigateToSession}
                />
              </div>
            ))}
          </AnimatePresence>
        ) : (
          <div className="flex items-center justify-center py-8 text-center">
            <div>
              <Filter className="w-4 h-4 text-primary/20 mx-auto mb-2" />
              <p className="text-[8px] font-mono text-primary/40">No events match filters</p>
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="border-t border-primary/10 pt-3 flex-shrink-0">
        <p className="text-[7px] font-mono text-primary/40 tracking-widest uppercase mb-2">Legend</p>
        <div className="grid grid-cols-2 gap-2 text-[7px]">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-primary border border-primary/40" />
            <span className="text-primary/50">Major Event</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-primary/20 border border-primary/40" />
            <span className="text-primary/50">Minor Event</span>
          </div>
        </div>
      </div>
    </div>
  );
}