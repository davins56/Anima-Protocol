import { useRef, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import CinematicMessageDisplay from "./CinematicMessageDisplay";

export default function CinematicMessageList({ 
  messages, 
  session, 
  characters, 
  isFocusMode,
  onSpeak 
}) {
  const messagesEndRef = useRef(null);
  const [visibleCount, setVisibleCount] = useState(20);

  const lastMessageCountRef = useRef(0);
  useEffect(() => {
    const currentCount = messages?.length || 0;
    if (currentCount > lastMessageCountRef.current) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: isFocusMode ? "smooth" : "auto" });
      }, 50);
    }
    lastMessageCountRef.current = currentCount;
  }, [messages, isFocusMode]);

  if (!messages || messages.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="font-mono text-[9px] sm:text-xs text-primary/25 tracking-[0.3em] uppercase">
          // Begin transmission
        </p>
      </div>
    );
  }

  const displayMessages = isFocusMode 
    ? messages 
    : messages.slice(-visibleCount);

  const PAGE_SIZE = 20;
  const hasMore = isFocusMode ? false : visibleCount < messages.length;

  const handleLoadMore = () => {
    setVisibleCount(prev => Math.min(prev + PAGE_SIZE, messages.length));
  };

  return (
    <div className={isFocusMode ? "space-y-6 sm:space-y-8 px-0" : "space-y-2 sm:space-y-4 px-2 sm:px-4"}>
      {hasMore && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex justify-center py-4"
        >
          <button
            onClick={handleLoadMore}
            className="px-4 py-2 border border-primary/30 bg-black/60 text-primary/60 hover:text-primary text-[9px] font-mono tracking-widest uppercase transition-all"
          >
            ↑ Load Earlier Messages
          </button>
        </motion.div>
      )}

      <AnimatePresence mode="popLayout">
        {displayMessages.map((msg, idx) => {
          const msgChar = characters.find(c => c.name === msg.character_name);
          return (
            <motion.div
              key={`${msg.timestamp}-${idx}`}
              layout
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <CinematicMessageDisplay
                message={msg}
                character={msgChar}
                isFocusMode={isFocusMode}
                onSpeak={onSpeak}
              />
            </motion.div>
          );
        })}
      </AnimatePresence>

      <div ref={messagesEndRef} className={isFocusMode ? "py-8" : "py-2"} />
    </div>
  );
}