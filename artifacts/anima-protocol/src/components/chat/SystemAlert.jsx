import { motion, AnimatePresence } from "framer-motion";
import { AlertTriangle, Zap, Wind, Heart, Eye, Clock, X } from "lucide-react";

const EVENT_ICONS = {
  environmental: Wind,
  social: Heart,
  supernatural: Eye,
  personal: Zap,
  external: AlertTriangle,
  temporal: Clock,
};

const EVENT_COLORS = {
  low: "border-blue-400/40 bg-blue-400/10 text-blue-400",
  medium: "border-yellow-400/40 bg-yellow-400/10 text-yellow-400",
  high: "border-red-400/40 bg-red-400/10 text-red-400",
};

export default function SystemAlert({ event, onDismiss }) {
  if (!event) return null;

  const Icon = EVENT_ICONS[event.event_type] || AlertTriangle;
  const colorClass = EVENT_COLORS[event.urgency] || EVENT_COLORS.medium;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.95 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -20, scale: 0.95 }}
        transition={{ duration: 0.4 }}
        className={`mx-4 p-4 border rounded-sm flex items-start gap-3 ${colorClass} relative overflow-hidden`}
      >
        {/* Animated background glow */}
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent animate-pulse" />

        {/* Content */}
        <div className="relative flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            <Icon className="w-4 h-4 flex-shrink-0 animate-pulse" />
            <span className="font-mono text-xs tracking-[0.15em] uppercase font-bold">
              [WORLD EVENT]
            </span>
            <span className="font-mono text-[9px] tracking-widest uppercase opacity-60">
              {event.urgency}
            </span>
          </div>
          <h4 className="font-mono text-sm tracking-wider uppercase mb-1.5">
            {event.event_title}
          </h4>
          <p className="font-mono text-xs leading-relaxed opacity-80">
            {event.event_description}
          </p>
          {event.affects_all && (
            <p className="text-[9px] font-mono tracking-widest uppercase mt-1.5 opacity-60">
              ⚠ This affects everyone in the scene
            </p>
          )}
        </div>

        {/* Dismiss button */}
        <button
          onClick={onDismiss}
          className="flex-shrink-0 mt-0.5 text-current opacity-50 hover:opacity-100 transition-opacity"
          title="Dismiss event"
        >
          <X className="w-4 h-4" />
        </button>
      </motion.div>
    </AnimatePresence>
  );
}