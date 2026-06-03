// @ts-check
import { X, Check } from "lucide-react";
import { motion } from "framer-motion";

/**
 * @param {{ character?: any, onAccept?: () => void, onReject?: () => void }} props
 */
export default function GuestCharacterPrompt({ character, onAccept, onReject }) {
  if (!character) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="fixed bottom-24 left-1/2 -translate-x-1/2 max-w-sm z-40"
    >
      <div className="border border-primary/40 bg-black/80 backdrop-blur-md rounded p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="flex-1">
            <h3 className="font-mono text-primary tracking-wider uppercase text-sm">
              {character.name}
            </h3>
            <p className="text-[9px] font-mono text-primary/60 mt-0.5">
              {character.universe && `From ${character.universe} •`} Entering the narrative
            </p>
          </div>
          <button
            onClick={onReject}
            className="text-primary/30 hover:text-primary transition-colors p-0.5"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-[10px] font-mono text-primary/70 leading-relaxed">
          {character.backstory || "A new character approaches..."}
        </p>

        <div className="flex gap-2 pt-1">
          <button
            onClick={onReject}
            className="flex-1 px-3 py-1.5 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Skip
          </button>
          <button
            onClick={onAccept}
            className="flex-1 px-3 py-1.5 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-1.5"
          >
            <Check className="w-3 h-3" />
            Accept
          </button>
        </div>
      </div>
    </motion.div>
  );
}