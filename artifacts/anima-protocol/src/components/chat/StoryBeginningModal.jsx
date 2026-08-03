import { useState } from "react";
import { Send, X } from "lucide-react";
import { motion } from "framer-motion";

export default function StoryBeginningModal({ isOpen, onSubmit, onSkip, character }) {
  const [text, setText] = useState("");

  const handleSubmit = () => {
    onSubmit(text.trim());
    setText("");
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-2xl bg-background border border-primary/30 rounded-lg shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60">
          <div>
            <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
              Begin Your Story
            </h2>
            <p className="text-[9px] font-mono text-primary/30 mt-1 tracking-widest">
              How do you enter this narrative?
            </p>
          </div>
          <button
            onClick={onSkip}
            className="text-primary/30 hover:text-primary transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          <p className="text-[10px] font-mono text-primary/60 leading-relaxed">
            Write how you came into this story — your arrival, your circumstances, your first moments in this world.
            This will appear at the beginning of your story.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="You find yourself..."
            autoFocus
            className="w-full h-40 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/20 font-mono text-sm px-4 py-3 focus:outline-none focus:border-primary/50 transition-colors resize-none"
          />

          <div className="text-[9px] font-mono text-primary/40">
            {text.length} characters
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-primary/20 bg-black/60 flex gap-3">
          <button
            onClick={onSkip}
            className="flex-1 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 font-mono text-[9px] tracking-widest uppercase transition-all"
          >
            Skip for Now
          </button>
          <button
            onClick={handleSubmit}
            disabled={!text.trim()}
            className="flex-1 py-2 border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 disabled:opacity-30 font-mono text-[9px] tracking-widest uppercase transition-all flex items-center justify-center gap-2"
          >
            <Send className="w-3 h-3" />
            Begin
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}