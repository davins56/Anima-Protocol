import { motion, AnimatePresence } from "framer-motion";
import { X, BookOpen, CheckCircle } from "lucide-react";

export default function DailySummaryModal({ summary, dayInfo, isOpen, onClose }) {
  if (!isOpen || !summary) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            className="w-full max-w-2xl max-h-[80vh] overflow-y-auto bg-background border border-primary/30 hud-corner glow-border"
          >
            {/* Header */}
            <div className="sticky top-0 px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md flex items-center justify-between">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-primary/60" />
                <div>
                  <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase text-sm">
                    Daily Recap
                  </h2>
                  {dayInfo && (
                    <p className="text-[9px] font-mono text-primary/40 mt-0.5">
                      {dayInfo.season} — Day {dayInfo.day_of_season}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={onClose}
                className="text-primary/30 hover:text-primary transition-colors p-1"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-4">
              {summary.title && (
                <div>
                  <h3 className="font-mono text-xs text-primary/60 tracking-widest uppercase mb-2">
                    Chapter Title
                  </h3>
                  <p className="font-mono text-sm text-primary/90">{summary.title}</p>
                </div>
              )}

              {summary.synopsis && (
                <div>
                  <h3 className="font-mono text-xs text-primary/60 tracking-widest uppercase mb-2">
                    Synopsis
                  </h3>
                  <p className="font-mono text-[10px] text-primary/70 leading-relaxed">
                    {summary.synopsis}
                  </p>
                </div>
              )}

              {summary.key_moments && summary.key_moments.length > 0 && (
                <div>
                  <h3 className="font-mono text-xs text-primary/60 tracking-widest uppercase mb-2">
                    Key Moments
                  </h3>
                  <div className="space-y-1.5">
                    {summary.key_moments.map((moment, idx) => (
                      <div key={idx} className="flex gap-2">
                        <CheckCircle className="w-3 h-3 text-primary/40 flex-shrink-0 mt-0.5" />
                        <p className="font-mono text-[9px] text-primary/60 leading-relaxed">
                          {moment}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {summary.characters_involved && summary.characters_involved.length > 0 && (
                <div>
                  <h3 className="font-mono text-xs text-primary/60 tracking-widest uppercase mb-2">
                    Characters Involved
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {summary.characters_involved.map((char, idx) => (
                      <span
                        key={idx}
                        className="px-2 py-1 border border-primary/20 bg-primary/5 font-mono text-[9px] text-primary/70"
                      >
                        {char}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {summary.emotional_arc && (
                <div>
                  <h3 className="font-mono text-xs text-primary/60 tracking-widest uppercase mb-2">
                    Emotional Arc
                  </h3>
                  <p className="font-mono text-[9px] text-primary/60 leading-relaxed">
                    {summary.emotional_arc}
                  </p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="sticky bottom-0 px-6 py-3 border-t border-primary/10 bg-black/40 flex justify-end">
              <button
                onClick={onClose}
                className="px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all"
              >
                Continue
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}