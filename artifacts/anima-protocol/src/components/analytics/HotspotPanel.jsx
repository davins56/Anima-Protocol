import { useState } from 'react';
import { ChevronDown, AlertCircle, Zap, TrendingUp } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const getIntensityColor = (intensity) => {
  if (intensity >= 80) return 'text-red-400 border-red-400/30 bg-red-400/5';
  if (intensity >= 70) return 'text-orange-400 border-orange-400/30 bg-orange-400/5';
  if (intensity >= 60) return 'text-yellow-400 border-yellow-400/30 bg-yellow-400/5';
  return 'text-primary/60 border-primary/20 bg-primary/5';
};

const getIntensityIcon = (intensity) => {
  if (intensity >= 80) return <Zap className="w-4 h-4" />;
  if (intensity >= 70) return <AlertCircle className="w-4 h-4" />;
  return <TrendingUp className="w-4 h-4" />;
};

export default function HotspotPanel({ hotspots, onSelectHotspot }) {
  const [expandedHotspot, setExpandedHotspot] = useState(null);

  if (!hotspots || hotspots.length === 0) {
    return (
      <div className="p-4 border border-primary/15 bg-black/40 rounded text-center">
        <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
          No narrative hot spots detected
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 px-3 py-2 border border-primary/15 bg-primary/5 rounded">
        <Zap className="w-3.5 h-3.5 text-yellow-400" />
        <span className="font-mono text-[9px] text-primary/40 tracking-widest uppercase">
          {hotspots.length} Narrative Hot Spots
        </span>
      </div>

      <div className="space-y-2 max-h-96 overflow-y-auto">
        <AnimatePresence>
          {hotspots.map((hotspot, idx) => (
            <motion.div
              key={idx}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.05 }}
              className={`border rounded overflow-hidden transition-all ${getIntensityColor(hotspot.intensity)}`}
            >
              <button
                onClick={() => {
                  setExpandedHotspot(expandedHotspot === idx ? null : idx);
                  onSelectHotspot?.(hotspot);
                }}
                className="w-full flex items-start justify-between gap-3 p-3 hover:opacity-80 transition-opacity"
              >
                <div className="flex-1 text-left min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    {getIntensityIcon(hotspot.intensity)}
                    <span className="font-mono text-[10px] font-semibold truncate">
                      Msg #{hotspot.message_index}
                    </span>
                    <span className="font-mono text-[9px] opacity-70">
                      +{hotspot.delta} intensity
                    </span>
                  </div>
                  <p className="font-mono text-[8px] opacity-60 leading-relaxed line-clamp-2 truncate">
                    {hotspot.preview}
                  </p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[8px] font-mono opacity-50">{hotspot.character}</span>
                    <div className="flex-1 h-1 bg-black/30 rounded overflow-hidden">
                      <div
                        className="h-full bg-current transition-all"
                        style={{ width: `${hotspot.intensity}%` }}
                      />
                    </div>
                    <span className="text-[9px] font-mono font-bold whitespace-nowrap">{hotspot.intensity}</span>
                  </div>
                </div>
                <ChevronDown
                  className={`w-4 h-4 flex-shrink-0 mt-1 transition-transform ${
                    expandedHotspot === idx ? 'rotate-180' : ''
                  }`}
                />
              </button>

              <AnimatePresence>
                {expandedHotspot === idx && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="px-3 py-3 border-t border-current opacity-50 bg-black/20"
                  >
                    <div className="space-y-2">
                      <div>
                        <p className="text-[9px] font-mono tracking-widest uppercase mb-1">Full Context</p>
                        <p className="text-[8px] leading-relaxed">{hotspot.preview}</p>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[8px]">
                        <div>
                          <p className="font-mono tracking-widest uppercase opacity-70 mb-0.5">Timestamp</p>
                          <p className="font-mono">
                            {new Date(hotspot.timestamp).toLocaleTimeString()}
                          </p>
                        </div>
                        <div>
                          <p className="font-mono tracking-widest uppercase opacity-70 mb-0.5">Intensity Peak</p>
                          <p className="font-mono">{hotspot.intensity}/100</p>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}