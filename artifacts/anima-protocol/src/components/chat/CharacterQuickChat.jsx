import { useState } from "react";
import { MessageSquare, ChevronDown } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import PrivateChatPanel from "./PrivateChatPanel";

export default function CharacterQuickChat({ characters, sessionId, mode, groupCharacterIds }) {
  const [showPicker, setShowPicker] = useState(false);
  const [privateChar, setPrivateChar] = useState(null);

  // For group sessions, show all group chars; for solo, show all other available chars
  const availableChars = mode === "group"
    ? characters.filter(c => groupCharacterIds?.includes(c.id))
    : characters.filter(c => !c._isAnima).slice(0, 20);

  if (availableChars.length === 0) return null;

  return (
    <>
      <div className="relative">
        <button
          onClick={() => setShowPicker(p => !p)}
          className="flex items-center gap-1.5 px-2.5 py-1.5 border border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] tracking-widest uppercase transition-all"
          title="Private chat with a character"
        >
          <MessageSquare className="w-3 h-3" />
          <span className="hidden sm:inline">Private</span>
          <ChevronDown className="w-2.5 h-2.5" />
        </button>

        <AnimatePresence>
          {showPicker && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.97 }}
              className="absolute right-0 top-10 z-50 w-52 border bg-black/95 backdrop-blur-xl overflow-hidden"
              style={{ borderColor: "rgba(0,255,200,0.15)" }}
            >
              <div className="px-3 py-2 border-b" style={{ borderColor: "rgba(0,255,200,0.08)" }}>
                <p className="font-mono text-[8px] text-primary/40 tracking-[0.3em] uppercase">Private Channel</p>
              </div>
              <div className="max-h-64 overflow-y-auto">
                {availableChars.map(char => (
                  <button
                    key={char.id}
                    onClick={() => { setPrivateChar(char); setShowPicker(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2.5 border-b text-left transition-all hover:bg-primary/5"
                    style={{ borderColor: "rgba(0,255,200,0.05)" }}
                  >
                    {char.avatar_url ? (
                      <img src={char.avatar_url} alt={char.name} className="w-6 h-6 object-cover border border-primary/20 flex-shrink-0" />
                    ) : (
                      <div className="w-6 h-6 bg-primary/10 border border-primary/20 flex items-center justify-center flex-shrink-0">
                        <span className="font-mono text-primary text-[9px]">{char.name[0]}</span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-mono text-[9px] text-primary/70 tracking-wider uppercase truncate">{char.name}</p>
                      {char.universe && (
                        <p className="font-mono text-[7px] text-primary/25 truncate">{char.universe}</p>
                      )}
                    </div>
                    <MessageSquare className="w-3 h-3 text-primary/20 flex-shrink-0" />
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {privateChar && (
        <PrivateChatPanel
          character={privateChar}
          parentSessionId={sessionId}
          onClose={() => setPrivateChar(null)}
        />
      )}
    </>
  );
}