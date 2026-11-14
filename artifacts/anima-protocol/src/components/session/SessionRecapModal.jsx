import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Share2, Loader, BookOpen } from "lucide-react";
import { animaClient } from "@/api/animaClient";
import { buildSessionRecapExport, normalizeSessionRecap } from "@/lib/sessionRecap";

export default function SessionRecapModal({ isOpen, sessionId, onClose }) {
  const [recap, setRecap] = useState(null);
  const [loading, setLoading] = useState(false);
  // Only the newest request may update the modal, so a slow recap for a
  // previous session (or an earlier Try again) cannot overwrite this one.
  const requestRef = useRef(0);

  useEffect(() => {
    if (isOpen && sessionId) {
      generateRecap();
    }
  }, [isOpen, sessionId]);

  const generateRecap = async () => {
    const requestId = ++requestRef.current;
    const isCurrent = () => requestId === requestRef.current;
    setLoading(true);
    setRecap(null);
    try {
      // The recap is for THIS session, not whichever session was updated last.
      // (list("-updated_date", 1) returned only the newest session, so a recap
      // opened from any other chat found nothing.) Metadata is enough here; the
      // server reads the messages itself.
      const session = await animaClient.entities.ChatSession.get(sessionId, {
        withMessages: false,
      }).catch(() => null);
      const summaryRes = await animaClient.functions.invoke("generateSessionSummary", {
        session_id: sessionId,
      });
      if (isCurrent()) setRecap(normalizeSessionRecap(summaryRes, session));
    } catch (err) {
      console.error("Error generating recap:", err);
      if (isCurrent()) setRecap(normalizeSessionRecap(null, null));
    } finally {
      if (isCurrent()) setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!recap) return;
    const content = buildSessionRecapExport(recap);
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/plain;charset=utf-8," + encodeURIComponent(content));
    element.setAttribute("download", `session-recap-${new Date().toISOString().split("T")[0]}.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
        >
          <motion.div
            initial={{ scale: 0.9, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.9, opacity: 0 }}
            className="w-full max-w-3xl max-h-[90vh] bg-background border border-primary/30 flex flex-col overflow-hidden hud-corner glow-border"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-primary/20 bg-black/60 flex-shrink-0">
              <div className="flex items-center gap-3">
                <BookOpen className="w-5 h-5 text-primary" />
                <h2 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
                  // Session Recap
                </h2>
              </div>
              <button
                onClick={onClose}
                className="text-primary/30 hover:text-primary transition-colors"
              >
                <X className="w-6 h-6" />
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <Loader className="w-8 h-8 text-primary/60 animate-spin mx-auto mb-3" />
                    <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
                      Compiling session recap...
                    </p>
                  </div>
                </div>
              ) : recap ? (
                <>
                  {/* Title & Meta */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-2"
                  >
                    <h1 className="font-mono text-2xl sm:text-3xl text-primary glow-text tracking-wider uppercase">
                      {recap.title}
                    </h1>
                    <div className="flex flex-wrap items-center gap-4 text-[9px] font-mono text-primary/50">
                      <span>{recap.date}</span>
                      <span className="hidden sm:inline">•</span>
                      <span className="hidden sm:inline">{recap.time}</span>
                      <span>•</span>
                      <span>{recap.messageCount} messages</span>
                    </div>
                  </motion.div>

                  {/* Summary (or why there is none) */}
                  {recap.generated ? (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      className="p-4 border border-primary/20 bg-primary/5 space-y-2"
                    >
                      <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                        Summary
                      </p>
                      <p className="font-mono text-sm leading-relaxed text-primary/80">
                        {recap.summary}
                      </p>
                    </motion.div>
                  ) : (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.1 }}
                      role="alert"
                      className="p-4 border border-amber-400/30 bg-amber-400/5 space-y-3"
                    >
                      <p className="font-mono text-sm leading-relaxed text-amber-300/90">
                        {recap.error}
                      </p>
                      <button
                        onClick={generateRecap}
                        className="px-4 py-1.5 border border-amber-400/40 text-amber-300 hover:bg-amber-400/10 font-mono text-[10px] tracking-widest uppercase transition-all"
                      >
                        Try again
                      </button>
                    </motion.div>
                  )}

                  {/* Key Moments */}
                  {recap.keyMoments.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.2 }}
                      className="space-y-3"
                    >
                      <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                        Key Moments
                      </p>
                      <div className="space-y-2">
                        {recap.keyMoments.map((moment, idx) => (
                          <div
                            key={idx}
                            className="flex gap-3 p-3 border border-primary/15 bg-black/40"
                          >
                            <span className="font-mono text-primary/60 flex-shrink-0">{idx + 1}.</span>
                            <p className="font-mono text-sm text-primary/80">{moment}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}

                  {/* Emotional Arc */}
                  {recap.emotionalArc && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.3 }}
                      className="p-4 border border-cyan-400/30 bg-cyan-400/5 space-y-2"
                    >
                      <p className="text-[9px] font-mono text-cyan-400/60 tracking-widest uppercase">
                        Emotional Arc
                      </p>
                      <p className="font-mono text-sm text-cyan-400/80 leading-relaxed">
                        {recap.emotionalArc}
                      </p>
                    </motion.div>
                  )}

                  {/* Journal Entry */}
                  {recap.journalEntry && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.4 }}
                      className="p-4 border border-pink-400/30 bg-pink-400/5 space-y-2"
                    >
                      <p className="text-[9px] font-mono text-pink-400/60 tracking-widest uppercase">
                        Journal Entry
                      </p>
                      <p className="font-mono text-sm text-pink-400/80 leading-relaxed whitespace-pre-wrap">
                        {recap.journalEntry}
                      </p>
                    </motion.div>
                  )}

                  {/* Reflections */}
                  {recap.reflections.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.5 }}
                      className="space-y-3"
                    >
                      <p className="text-[9px] font-mono text-primary/40 tracking-widest uppercase">
                        Session Reflections
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {recap.reflections.map((reflection, idx) => (
                          <div key={idx} className="p-3 border border-primary/15 bg-black/40">
                            <p className="font-mono text-[10px] text-primary/80">{reflection}</p>
                          </div>
                        ))}
                      </div>
                    </motion.div>
                  )}
                </>
              ) : null}
            </div>

            {/* Footer */}
            {recap && !loading && (
              <div className="flex items-center justify-end gap-3 p-6 border-t border-primary/20 bg-black/60 flex-shrink-0">
                <button
                  onClick={onClose}
                  className="px-6 py-2 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/40 font-mono text-xs tracking-widest uppercase transition-all"
                >
                  Close
                </button>
                <button
                  onClick={handleDownload}
                  className="flex items-center gap-2 px-6 py-2 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 font-mono text-xs tracking-widest uppercase transition-all hud-corner glow-border"
                >
                  <Download className="w-4 h-4" />
                  Export
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}