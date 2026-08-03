import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronDown } from 'lucide-react';

export default function CharacterAvatarRow({ session, characters }) {
  const [showExpanded, setShowExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);

  const sessionCharacters = session?.mode === 'solo' && session?.character_id
    ? characters.filter(c => c.id === session.character_id)
    : characters.filter(c => session?.group_character_ids?.includes(c.id));

  if (sessionCharacters.length === 0) return null;

  return (
    <>
      {/* Toggle Button */}
      <button
        onClick={() => setIsVisible(!isVisible)}
        className="flex items-center gap-1 px-2 py-1 border border-primary/20 hover:border-primary/40 text-primary/40 hover:text-primary font-mono text-[8px] tracking-widest uppercase transition-all flex-shrink-0"
      >
        <ChevronDown className={`w-3 h-3 transition-transform ${isVisible ? 'rotate-180' : ''}`} />
        <span>Cast</span>
      </button>

      {/* Avatar Row - Collapsible */}
      <AnimatePresence>
        {isVisible && (
          <motion.button
            initial={{ opacity: 0, width: 0 }}
            animate={{ opacity: 1, width: 'auto' }}
            exit={{ opacity: 0, width: 0 }}
            onClick={() => setShowExpanded(true)}
            className="flex items-center gap-2 px-3 py-2 border border-primary/20 bg-black/40 hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer overflow-hidden flex-shrink-0"
          >
            <div className="flex -space-x-2">
              {sessionCharacters.slice(0, 5).map((char) => (
                <div
                  key={char.id}
                  className="w-7 h-7 border border-primary/40 rounded overflow-hidden bg-primary/10 flex-shrink-0"
                >
                  {char.avatar_url ? (
                    <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-[9px] font-mono text-primary/60">
                      {char.name[0]}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <span className="text-[9px] font-mono text-primary/50 tracking-widest whitespace-nowrap">
              {sessionCharacters.length} {sessionCharacters.length === 1 ? 'CHARACTER' : 'CHARACTERS'}
            </span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* Expanded Modal */}
      <AnimatePresence>
        {showExpanded && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
            onClick={() => setShowExpanded(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-2xl bg-background border border-primary/30 rounded p-6 max-h-[80vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between mb-6">
                <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                  // Characters ({sessionCharacters.length})
                </h2>
                <button
                  onClick={() => setShowExpanded(false)}
                  className="text-primary/30 hover:text-primary transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {sessionCharacters.map((char) => (
                  <div
                    key={char.id}
                    className="border border-primary/15 bg-black/40 hover:border-primary/30 p-4 rounded transition-all"
                  >
                    {char.avatar_url ? (
                      <img
                        src={char.avatar_url}
                        alt={char.name}
                        className="w-full aspect-square object-cover rounded mb-3 border border-primary/20"
                      />
                    ) : (
                      <div className="w-full aspect-square bg-primary/5 flex items-center justify-center rounded mb-3 border border-primary/20">
                        <span className="font-mono text-4xl text-primary/30">{char.name[0]}</span>
                      </div>
                    )}

                    <h3 className="font-mono text-sm text-primary tracking-wider uppercase mb-1">
                      {char.name}
                    </h3>
                    {char.universe && (
                      <p className="text-[9px] font-mono text-primary/40 mb-2 tracking-widest">
                        {char.universe}
                      </p>
                    )}
                    {char.category && (
                      <span className="inline-block text-[8px] font-mono text-primary/50 border border-primary/20 px-2 py-1 rounded">
                        {char.category}
                      </span>
                    )}
                    {char.personality && (
                      <p className="text-[9px] font-mono text-primary/50 mt-2 leading-relaxed line-clamp-2">
                        {char.personality}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}