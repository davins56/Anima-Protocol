import { useEffect, useState } from "react";
import { motion } from "framer-motion";

export default function WorldMap({ currentLocation, loreEntries = [], calendar, resonance = 50 }) {
  const [displayRegion, setDisplayRegion] = useState("THE DIGITAL VOID");

  useEffect(() => {
    if (currentLocation) {
      setDisplayRegion(currentLocation.toUpperCase());
    } else if (loreEntries?.length > 0) {
      const primary = loreEntries.find((l) => l.importance === "critical");
      setDisplayRegion((primary?.subject || "UNKNOWN REGION").toUpperCase());
    }
  }, [currentLocation, loreEntries]);

  return (
    <div className="bg-black/90 border border-cyan-900/60 rounded-2xl p-5 mb-6 overflow-hidden relative">
      <div className="flex justify-between items-start mb-4">
        <div>
          <div className="font-mono text-[10px] tracking-[0.25em] text-cyan-400">ANIMA PROTOCOL // WORLD MAP</div>
          <div className="text-lg font-light text-white tracking-widest mt-1">{displayRegion}</div>
        </div>

        {calendar && (
          <div className="text-right text-xs text-cyan-500/70 font-mono">
            {calendar.current_season}
            <br />
            DAY {calendar.day_of_season} • {calendar.time_of_day}
          </div>
        )}
      </div>

      <div className="relative h-72 bg-zinc-950 border border-cyan-950/80 rounded-xl overflow-hidden flex items-center justify-center">
        {/* Subtle grid + particle field */}
        <div className="absolute inset-0 bg-[radial-gradient(#67e8f9_0.6px,transparent_1px)] [background-size:24px_24px] opacity-10"></div>

        <motion.div
          animate={{
            scale: [1, 1.08, 1],
            opacity: [0.7, 1, 0.7],
          }}
          transition={{ duration: 6, repeat: Infinity }}
          className="text-center z-10"
        >
          <div className="text-7xl mb-4 opacity-90">🜁</div>
          <div className="text-cyan-300 text-xl font-mono tracking-[0.15em]">{displayRegion}</div>
          <div className="mt-2 text-[10px] text-cyan-400/60">RESONANCE FIELD: {resonance}%</div>
        </motion.div>

        {currentLocation && (
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 px-6 py-1 bg-black/70 border border-cyan-400/30 rounded-full text-xs tracking-widest text-cyan-300">
            CURRENT TRANSMISSION POINT
          </div>
        )}
      </div>
    </div>
  );
}
