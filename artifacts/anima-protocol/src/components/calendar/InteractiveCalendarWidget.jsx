import { useState, useEffect } from 'react';
import { ChevronLeft, ChevronRight, Calendar, Cloud, CloudRain, Sun, Snowflake } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SEASON_COLORS = {
  spring: 'from-green-900 to-emerald-800',
  summer: 'from-yellow-900 to-orange-800',
  autumn: 'from-orange-900 to-red-800',
  winter: 'from-blue-900 to-cyan-800',
};

const WEATHER_ICONS = {
  clear: Sun,
  cloudy: Cloud,
  rainy: CloudRain,
  stormy: CloudRain,
  snowy: Snowflake,
  foggy: Cloud,
};

export default function InteractiveCalendarWidget({ calendar, onAdvanceDay }) {
  const [expanded, setExpanded] = useState(false);
  const [todayInfo, setTodayInfo] = useState({});

  useEffect(() => {
    if (calendar) {
      const holidays = (calendar.holidays || []).filter((h) => h.date === calendar.current_day);
      const birthdays = (calendar.character_birthdays || []).filter((b) => b.birth_date === calendar.current_day);
      const events = (calendar.world_events || []).filter((e) => e.date === calendar.current_day);
      setTodayInfo({ holidays, birthdays, events });
    }
  }, [calendar]);

  if (!calendar) return null;

  const WeatherIcon = WEATHER_ICONS[calendar.weather] || Sun;
  const hasSpecialDate = todayInfo.holidays?.length > 0 || todayInfo.birthdays?.length > 0 || todayInfo.events?.length > 0;

  return (
    <div className="w-full border border-primary/20 bg-black/40 backdrop-blur-sm rounded">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-primary/5 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Calendar className="w-4 h-4 text-primary" />
          <div className="text-left">
            <p className="font-mono text-xs text-primary tracking-widest uppercase">
              {calendar.current_season} — Day {calendar.current_day}
            </p>
            <p className="text-[9px] text-primary/40 mt-0.5">Year {calendar.year}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <WeatherIcon className="w-3.5 h-3.5 text-primary/60" />
            <span className="text-[9px] text-primary/50 capitalize tracking-wider">{calendar.weather}</span>
          </div>
          <ChevronRight className={`w-4 h-4 text-primary/40 transition-transform ${expanded ? 'rotate-90' : ''}`} />
        </div>
      </button>

      {/* Expanded Content */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="border-t border-primary/10 bg-primary/5"
          >
            <div className="p-4 space-y-4">
              {/* Season Progress */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[9px] font-mono text-primary/50 uppercase tracking-wider">Season Progress</span>
                  <span className="text-[9px] text-primary/40">{Math.round(calendar.season_progression * 100)}%</span>
                </div>
                <div className="w-full h-1.5 bg-black/40 border border-primary/10 overflow-hidden">
                  <div
                    className={`h-full bg-gradient-to-r ${SEASON_COLORS[calendar.current_season]} transition-all`}
                    style={{ width: `${calendar.season_progression * 100}%` }}
                  />
                </div>
              </div>

              {/* Time of Day */}
              <div className="text-[9px]">
                <p className="font-mono text-primary/50 uppercase tracking-wider mb-1">Time</p>
                <p className="text-primary/70 capitalize">{calendar.time_of_day}</p>
              </div>

              {/* Special Dates */}
              {hasSpecialDate && (
                <div className="border-t border-primary/10 pt-3 space-y-2">
                  {todayInfo.holidays?.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-amber-400/70 uppercase tracking-wider mb-1">Holidays</p>
                      <div className="space-y-1">
                        {todayInfo.holidays.map((h) => (
                          <p key={h.id} className="text-[9px] text-primary/70">
                            🎉 {h.name}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {todayInfo.birthdays?.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-purple-400/70 uppercase tracking-wider mb-1">Birthdays</p>
                      <div className="space-y-1">
                        {todayInfo.birthdays.map((b) => (
                          <p key={b.character_id} className="text-[9px] text-primary/70">
                            🎂 {b.character_name}'s birthday
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                  {todayInfo.events?.length > 0 && (
                    <div>
                      <p className="text-[9px] font-mono text-cyan-400/70 uppercase tracking-wider mb-1">World Events</p>
                      <div className="space-y-1">
                        {todayInfo.events.map((e) => (
                          <p key={e.id} className="text-[9px] text-primary/70">
                            ⚡ {e.name}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Controls */}
              <div className="border-t border-primary/10 pt-3 flex gap-2">
                <button
                  onClick={() => onAdvanceDay(-1)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
                >
                  <ChevronLeft className="w-3 h-3" />
                  Prev
                </button>
                <button
                  onClick={() => onAdvanceDay(1)}
                  className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 bg-primary/10 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-[9px] tracking-widest uppercase transition-all"
                >
                  Next
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}