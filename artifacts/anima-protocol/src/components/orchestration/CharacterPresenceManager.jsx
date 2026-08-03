import { motion } from 'framer-motion';
import { Eye, EyeOff } from 'lucide-react';

export default function CharacterPresenceManager({
  characters,
  scenePresence,
  presentCharacters,
  absentCharacters,
  onTogglePresence,
}) {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase mb-4">
          Character Presence
        </h2>

        {/* Present Characters */}
        <div className="space-y-3">
          <div>
            <p className="font-mono text-[8px] text-green-400/60 tracking-widest uppercase mb-2">
              On Scene ({presentCharacters.length})
            </p>
            <div className="space-y-2">
              {presentCharacters.length > 0 ? (
                presentCharacters.map((char) => (
                  <motion.button
                    key={char.id}
                    onClick={() => onTogglePresence(char.id)}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="w-full flex items-center justify-between gap-3 p-3 bg-green-900/20 border border-green-400/40 hover:border-green-400/60 text-green-400 rounded transition-all group"
                  >
                    <div className="flex items-center gap-2 min-w-0 text-left">
                      <Eye className="w-4 h-4 flex-shrink-0" />
                      <span className="font-mono text-sm truncate">{char.name}</span>
                    </div>
                    <span className="text-[8px] text-green-400/50 group-hover:text-green-400/80 transition-colors flex-shrink-0">
                      Hide
                    </span>
                  </motion.button>
                ))
              ) : (
                <p className="text-[9px] text-primary/30 italic p-3">No characters on scene</p>
              )}
            </div>
          </div>

          {/* Absent Characters */}
          <div className="pt-4 border-t border-primary/10">
            <p className="font-mono text-[8px] text-red-400/60 tracking-widest uppercase mb-2">
              Off Scene ({absentCharacters.length})
            </p>
            <div className="space-y-2">
              {absentCharacters.length > 0 ? (
                absentCharacters.map((char) => (
                  <motion.button
                    key={char.id}
                    onClick={() => onTogglePresence(char.id)}
                    layout
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    className="w-full flex items-center justify-between gap-3 p-3 bg-red-900/10 border border-red-400/20 hover:border-red-400/40 text-red-400/60 hover:text-red-400 rounded transition-all group"
                  >
                    <div className="flex items-center gap-2 min-w-0 text-left">
                      <EyeOff className="w-4 h-4 flex-shrink-0" />
                      <span className="font-mono text-sm truncate">{char.name}</span>
                    </div>
                    <span className="text-[8px] text-red-400/30 group-hover:text-red-400/60 transition-colors flex-shrink-0">
                      Show
                    </span>
                  </motion.button>
                ))
              ) : (
                <p className="text-[9px] text-primary/30 italic p-3">All characters present</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}