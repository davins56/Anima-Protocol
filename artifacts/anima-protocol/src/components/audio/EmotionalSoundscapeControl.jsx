import { useState } from "react";
import { Volume2, VolumeX, Music, Zap } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function EmotionalSoundscapeControl({ 
  isPlaying, 
  setIsPlaying, 
  volume, 
  setVolume, 
  intensity,
  currentSoundscape 
}) {
  const [showVolumeControl, setShowVolumeControl] = useState(false);

  if (!currentSoundscape) {
    return null;
  }

  const intensityLabel = {
    1: "Calm",
    2: "Moderate",
    3: "Intense",
    4: "Critical",
  };

  return (
    <div className="flex items-center gap-2">
      {/* Soundscape toggle */}
      <button
        onClick={() => setIsPlaying(!isPlaying)}
        title={isPlaying ? "Disable soundscape" : "Enable soundscape"}
        className={`flex items-center gap-1.5 px-2.5 py-1 border font-mono text-[9px] tracking-widest uppercase transition-all ${
          isPlaying
            ? "bg-purple-900/20 border-purple-400/40 text-purple-400 hover:bg-purple-900/30"
            : "bg-black/60 border-primary/20 text-primary/40 hover:text-primary/70 hover:border-primary/40"
        }`}
      >
        {isPlaying ? (
          <>
            <Music className="w-3 h-3" />
            <span className="hidden sm:inline">Soundscape</span>
          </>
        ) : (
          <>
            <VolumeX className="w-3 h-3" />
            <span className="hidden sm:inline">Muted</span>
          </>
        )}
      </button>

      {/* Volume control */}
      {isPlaying && (
        <div className="relative">
          <button
            onClick={() => setShowVolumeControl(!showVolumeControl)}
            className="flex items-center gap-1 px-1.5 py-1 border border-primary/20 text-primary/50 hover:text-primary/70 transition-colors"
            title="Adjust volume"
          >
            <Volume2 className="w-3 h-3" />
            <span className="font-mono text-[8px] text-primary/40 w-6 text-center">
              {Math.round(volume * 100)}%
            </span>
          </button>

          <AnimatePresence>
            {showVolumeControl && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="absolute bottom-full right-0 mb-2 p-2 bg-background border border-primary/20 rounded"
              >
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={Math.round(volume * 100)}
                  onChange={(e) => setVolume(parseInt(e.target.value) / 100)}
                  className="w-24 h-2 bg-primary/10 rounded accent-primary"
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )}

      {/* Intensity indicator */}
      {isPlaying && (
        <div className="flex items-center gap-1 px-2 py-1 border border-primary/15 bg-primary/5 rounded">
          <Zap className="w-3 h-3 text-primary/60" />
          <span className="font-mono text-[8px] text-primary/50 tracking-widest uppercase">
            {intensityLabel[intensity] || "Calm"}
          </span>
        </div>
      )}
    </div>
  );
}