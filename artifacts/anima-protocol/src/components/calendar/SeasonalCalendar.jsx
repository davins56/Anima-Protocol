import { motion } from "framer-motion";
import { ChevronLeft, ChevronRight, Zap } from "lucide-react";

const SEASONS = ["spring", "summer", "autumn", "winter"];
const SEASON_COLORS = {
  spring: "border-green-400/40 bg-green-400/5 text-green-400",
  summer: "border-yellow-400/40 bg-yellow-400/5 text-yellow-400",
  autumn: "border-orange-400/40 bg-orange-400/5 text-orange-400",
  winter: "border-blue-400/40 bg-blue-400/5 text-blue-400",
};

const SEASON_WEATHER = {
  spring: "🌱 Blooming",
  summer: "☀️ Scorching",
  autumn: "🍂 Cooling",
  winter: "❄️ Frozen",
};

export default function SeasonalCalendar({ calendar, events = [], onDaySelect }) {
  if (!calendar) return null;

  const { current_season, day_of_season, seasonal_description } = calendar;
  const daysPerSeason = 90;
  const totalDays = calendar.days_elapsed || (SEASONS.indexOf(current_season) * daysPerSeason + day_of_season);
  
  // Generate day cells for current season
  const generateSeasonDays = () => {
    const days = [];
    for (let i = 1; i <= daysPerSeason; i++) {
      const isCurrent = i === day_of_season;
      const isPast = i < day_of_season;
      const dayEvents = events.filter(
        e => e.source_message_index >= (i - 1) * 10 && e.source_message_index < i * 10
      );
      
      days.push({
        day: i,
        isCurrent,
        isPast,
        events: dayEvents,
      });
    }
    return days;
  };

  const seasonDays = generateSeasonDays();
  const nextSeason = SEASONS[(SEASONS.indexOf(current_season) + 1) % SEASONS.length];
  const daysUntilNextSeason = daysPerSeason - day_of_season;

  return (
    <div className="space-y-6">
      {/* Season Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className={`p-4 border rounded ${SEASON_COLORS[current_season]}`}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="font-mono text-lg tracking-widest uppercase">
              {current_season}
            </h2>
            <p className="text-[9px] font-mono opacity-60 mt-1">
              Day {day_of_season} of {daysPerSeason}
            </p>
          </div>
          <span className="text-3xl">{SEASON_WEATHER[current_season]}</span>
        </div>

        <p className="text-sm leading-relaxed opacity-80 mb-3">
          {seasonal_description || `The ${current_season} winds blow across the land...`}
        </p>

        {/* Progress bar */}
        <div className="w-full h-1 bg-current/20 border border-current/30 overflow-hidden">
          <div
            className="h-full bg-current/60 transition-all duration-300"
            style={{ width: `${(day_of_season / daysPerSeason) * 100}%` }}
          />
        </div>

        {/* Next season info */}
        <p className="text-[9px] font-mono text-current/50 mt-2 tracking-widest uppercase">
          {daysUntilNextSeason} days until {nextSeason}
        </p>
      </motion.div>

      {/* Day Grid */}
      <div>
        <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-3 pb-2 border-b border-primary/10">
          Season Timeline
        </h3>

        <div className="grid grid-cols-5 sm:grid-cols-7 lg:grid-cols-10 gap-2">
          {seasonDays.map((dayData, idx) => (
            <motion.button
              key={idx}
              onClick={() => onDaySelect?.(dayData.day)}
              whileHover={{ scale: 1.05 }}
              className={`p-2 border rounded text-center transition-all text-[9px] font-mono tracking-wider uppercase ${
                dayData.isCurrent
                  ? "border-primary/60 bg-primary/20 text-primary ring-2 ring-primary"
                  : dayData.isPast
                  ? "border-primary/15 bg-primary/5 text-primary/50"
                  : "border-primary/20 bg-black/40 text-primary/40 hover:border-primary/40"
              }`}
            >
              <div className="font-bold">{dayData.day}</div>
              {dayData.events.length > 0 && (
                <div className="text-[7px] text-yellow-400 mt-0.5">
                  {dayData.events.length}⚡
                </div>
              )}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Events on Current Day */}
      {seasonDays[day_of_season - 1]?.events.length > 0 && (
        <div>
          <h3 className="font-mono text-xs text-primary/60 tracking-[0.2em] uppercase mb-3 pb-2 border-b border-yellow-400/20">
            ⚡ Today's Events ({seasonDays[day_of_season - 1].events.length})
          </h3>
          <div className="space-y-2">
            {seasonDays[day_of_season - 1].events.map((event, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="p-3 border border-yellow-400/30 bg-yellow-400/5 text-yellow-400"
              >
                <div className="flex items-start gap-2">
                  <Zap className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="font-mono text-xs tracking-wider uppercase">
                      {event.subject || event.category}
                    </p>
                    <p className="text-[9px] font-mono text-yellow-400/70 mt-1 leading-relaxed line-clamp-2">
                      {event.fact}
                    </p>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 p-3 border border-primary/15 bg-primary/5">
        <div className="text-center">
          <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
            Total Days
          </p>
          <p className="text-xl font-mono text-primary mt-1">{totalDays}</p>
        </div>
        <div className="text-center">
          <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
            Progress
          </p>
          <p className="text-xl font-mono text-primary mt-1">
            {Math.round((day_of_season / daysPerSeason) * 100)}%
          </p>
        </div>
        <div className="text-center">
          <p className="text-[8px] font-mono text-primary/40 tracking-widest uppercase">
            Events
          </p>
          <p className="text-xl font-mono text-primary mt-1">{events.length}</p>
        </div>
      </div>
    </div>
  );
}