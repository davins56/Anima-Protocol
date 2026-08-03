import { Cloud, CloudSnow, Sun, CloudRain } from "lucide-react";

const SEASON_COLORS = {
  spring: "text-green-400 border-green-400/30 bg-green-400/10",
  summer: "text-yellow-400 border-yellow-400/30 bg-yellow-400/10",
  autumn: "text-orange-400 border-orange-400/30 bg-orange-400/10",
  winter: "text-cyan-300 border-cyan-300/30 bg-cyan-300/10"
};

const SEASON_EMOJIS = {
  spring: "🌱",
  summer: "☀️",
  autumn: "🍂",
  winter: "❄️"
};

const WEATHER_ICONS = {
  clear: Sun,
  cloudy: Cloud,
  rainy: CloudRain,
  snowy: CloudSnow,
  stormy: CloudRain
};

export default function CalendarDisplay({ calendar }) {
  if (!calendar) return null;

  const Icon = WEATHER_ICONS[calendar.weather] || Sun;
  const colorClass = SEASON_COLORS[calendar.current_season] || SEASON_COLORS.spring;

  return (
    <div className={`px-4 py-3 border border-primary/20 bg-primary/5 text-center space-y-1.5 ${colorClass}`}>
      <div className="flex items-center justify-center gap-2">
        <span className="text-xl">{SEASON_EMOJIS[calendar.current_season]}</span>
        <h3 className="font-mono text-xs tracking-[0.15em] uppercase font-bold">
          {calendar.current_season}
        </h3>
        <span className="font-mono text-[9px] tracking-widest">Day {calendar.day_of_season || 1}</span>
      </div>
      <p className="font-mono text-[10px] leading-relaxed opacity-80">
        {calendar.seasonal_description}
      </p>
      <div className="flex items-center justify-center gap-2 text-[9px] font-mono">
        <Icon className="w-3 h-3" />
        <span className="tracking-widest uppercase">{calendar.weather}</span>
        <span>•</span>
        <span>Day {calendar.days_elapsed || 0}</span>
      </div>
    </div>
  );
}