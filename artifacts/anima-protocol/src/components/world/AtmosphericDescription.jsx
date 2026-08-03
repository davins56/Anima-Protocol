import { motion } from "framer-motion";
import { Cloud, Wind, Eye } from "lucide-react";

export default function AtmosphericDescription({ description, location, isLoading = false }) {
  if (!description && !isLoading) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="border-l-4 border-cyan-400/50 bg-gradient-to-r from-cyan-400/10 to-transparent pl-4 pr-3 py-3 my-3 text-[9.5px] font-mono leading-relaxed text-cyan-100"
    >
      <div className="flex items-start gap-3">
        {/* Atmosphere Icon */}
        <div className="flex-shrink-0 mt-0.5 opacity-60 animate-pulse">
          <Wind className="w-3.5 h-3.5 text-cyan-400" />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Header */}
          {location && (
            <p className="text-[8px] text-cyan-400/60 tracking-widest uppercase font-semibold mb-1.5">
              ◆ {location}
            </p>
          )}

          {/* Description */}
          {isLoading ? (
            <div className="space-y-1">
              <div className="h-2 bg-cyan-400/20 rounded w-3/4 animate-pulse" />
              <div className="h-2 bg-cyan-400/20 rounded w-4/5 animate-pulse" />
            </div>
          ) : (
            <p className="text-cyan-100/90 leading-relaxed italic">
              {description}
            </p>
          )}
        </div>
      </div>

      {/* Subtle footer accent */}
      <div className="flex items-center gap-1.5 mt-2 text-[8px] text-cyan-400/40 ml-7">
        <Eye className="w-2.5 h-2.5" />
        <span>Environmental state</span>
      </div>
    </motion.div>
  );
}