import { useState, useRef, useEffect } from "react";
import { Send, Brain, X, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function MentalLine({ isOpen, onClose, onSendThought, serenity, loading }) {
  const [thought, setThought] = useState("");
  const [mentalHistory, setMentalHistory] = useState([]);
  const scrollRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mentalHistory]);

  const handleSend = async () => {
    if (!thought.trim()) return;

    const userThought = { role: "user", content: thought, type: "mental" };
    setMentalHistory((prev) => [...prev, userThought]);
    setThought("");

    const response = await onSendThought(thought);
    if (response) {
      setMentalHistory((prev) => [...prev, response]);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 20 }}
        className="fixed right-4 w-80 max-h-96 border border-purple-400/30 bg-purple-950/40 backdrop-blur-md rounded-lg shadow-2xl overflow-hidden flex flex-col z-40"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 80px)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-purple-400/20 bg-purple-900/30">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-purple-400" />
            <span className="font-mono text-xs text-purple-400 tracking-widest uppercase">Mental Line</span>
          </div>
          <button
            onClick={onClose}
            className="text-purple-400/50 hover:text-purple-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3 min-h-0">
          {mentalHistory.length === 0 && (
            <p className="text-[9px] font-mono text-purple-400/30 text-center mt-4">
              Reach out to Serenity...
            </p>
          )}
          {mentalHistory.map((msg, idx) => (
            <div
              key={idx}
              className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[70%] px-3 py-2 rounded text-[9px] font-mono leading-relaxed ${
                  msg.role === "user"
                    ? "bg-purple-500/20 text-purple-200 border border-purple-400/20"
                    : "bg-purple-600/20 text-purple-100 border border-purple-500/20"
                }`}
              >
                {msg.content}
              </div>
            </div>
          ))}
          {loading && (
            <div className="flex justify-start">
              <div className="px-3 py-2 rounded bg-purple-600/20 border border-purple-500/20">
                <Loader className="w-3 h-3 text-purple-400 animate-spin" />
              </div>
            </div>
          )}
          <div ref={scrollRef} />
        </div>

        {/* Input */}
        <div className="px-3 py-2 border-t border-purple-400/20 bg-purple-900/30 flex gap-2">
          <input
            value={thought}
            onChange={(e) => setThought(e.target.value)}
            onKeyPress={(e) => e.key === "Enter" && handleSend()}
            placeholder="What's on your mind?"
            disabled={loading}
            className="flex-1 bg-black/40 border border-purple-400/20 text-purple-200 placeholder-purple-400/30 font-mono text-[9px] px-2 py-1.5 focus:outline-none focus:border-purple-400/40 transition-colors disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!thought.trim() || loading}
            className="px-2 py-1.5 bg-purple-600/30 border border-purple-400/30 text-purple-400 hover:bg-purple-600/50 disabled:opacity-30 font-mono text-[9px] transition-all flex items-center justify-center"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}