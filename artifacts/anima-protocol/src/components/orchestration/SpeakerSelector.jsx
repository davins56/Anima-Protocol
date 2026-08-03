import { motion } from 'framer-motion';
import { Mic, ArrowRight, Loader } from 'lucide-react';
import { useState } from 'react';

export default function SpeakerSelector({
  characters,
  nextSpeaker,
  onSelectSpeaker,
  onForceSpeaker,
}) {
  const [forcing, setForcing] = useState(false);

  const handleForce = async (characterId) => {
    setForcing(true);
    await onForceSpeaker(characterId);
    setForcing(false);
  };

  const selectedChar = characters.find(c => c.id === nextSpeaker);

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-mono text-[9px] text-primary/60 tracking-widest uppercase mb-4">
          Next Speaker
        </h2>

        {/* Current Selection */}
        {selectedChar && (
          <motion.div
            layout
            className="p-4 border border-cyan-400/40 bg-cyan-900/20 rounded-lg mb-4 space-y-2"
          >
            <div className="flex items-center gap-2">
              <Mic className="w-4 h-4 text-cyan-400" />
              <p className="font-mono text-[9px] text-cyan-400/60 tracking-widest uppercase">
                Current Selection
              </p>
            </div>
            <p className="font-mono text-lg text-cyan-400 font-semibold">{selectedChar.name}</p>
            <button
              onClick={() => handleForce(selectedChar.id)}
              disabled={forcing}
              className="w-full mt-3 px-4 py-2.5 bg-cyan-600/30 border border-cyan-400/60 text-cyan-400 hover:bg-cyan-600/50 disabled:opacity-50 font-mono text-[9px] tracking-widest uppercase transition-all rounded flex items-center justify-center gap-2"
            >
              {forcing ? (
                <>
                  <Loader className="w-3 h-3 animate-spin" />
                  Forcing...
                </>
              ) : (
                <>
                  <ArrowRight className="w-3 h-3" />
                  Force Next Line
                </>
              )}
            </button>
          </motion.div>
        )}

        {/* Character Selection Grid */}
        <div>
          <p className="font-mono text-[8px] text-primary/40 tracking-widest uppercase mb-2">
            Select Speaker
          </p>
          <div className="grid grid-cols-2 gap-2">
            {characters.length > 0 ? (
              characters.map((char) => (
                <motion.button
                  key={char.id}
                  onClick={() => onSelectSpeaker(char.id)}
                  layout
                  className={`relative p-3 border rounded transition-all font-mono text-[9px] tracking-widest uppercase ${
                    nextSpeaker === char.id
                      ? 'border-cyan-400/60 bg-cyan-900/30 text-cyan-400'
                      : 'border-primary/15 bg-black/40 text-primary/60 hover:border-primary/40 hover:text-primary/80'
                  }`}
                >
                  {nextSpeaker === char.id && (
                    <motion.div
                      layoutId="speaker-indicator"
                      className="absolute inset-0 border border-cyan-400/60 rounded pointer-events-none"
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    />
                  )}
                  <span className="relative">{char.name}</span>
                </motion.button>
              ))
            ) : (
              <p className="col-span-2 text-[9px] text-primary/30 italic text-center p-4">
                No characters present on scene
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}