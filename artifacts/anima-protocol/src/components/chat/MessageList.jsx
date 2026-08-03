import { useState } from "react";
import MessageBubble from "./MessageBubble";
import { parseGroupResponse } from "@/lib/parseGroupResponse";
import { ChevronUp, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

const PAGE_SIZE = 20; // messages shown per "page"

export default function MessageList({ messages, session, characters, characterMemories = [], characterEmotions = {}, loreLinks = {}, onRewindToMessage, onSpeak, onEditMessage, onDeleteMessage, onRegenerateMessage }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);

  const groupChars = session?.mode === "group"
    ? characters.filter(c => session.group_character_ids?.includes(c.id))
    : [];

  // Build the full rendered list first
  const allRendered = [];

  (messages || []).forEach((msg, i) => {
    if (
      msg.role === "assistant" &&
      msg.character_name !== "__typing__" &&
      msg.type !== "event" &&
      groupChars.length > 0 &&
      /\*\*[^*:]+\*\*:/.test(msg.content || "")
    ) {
      const split = parseGroupResponse(msg.content, groupChars, msg.character_name);
      if (split.length > 1) {
        split.forEach((subMsg, j) => {
                    const subChar = characters.find(c => c.name === subMsg.character_name);
                    allRendered.push({
                      key: `${i}-${j}`,
                      element: (
                        <MessageBubble
                          key={`${i}-${j}`}
                          message={subMsg}
                          character={subChar}
                          characterMemories={characterMemories}
                          characterEmotion={characterEmotions?.[subChar?.id]?.emotion || 'neutral'}
                          characterEmotionIntensity={characterEmotions?.[subChar?.id]?.intensity || 5}
                          onRewind={j === 0 ? () => onRewindToMessage(i) : undefined}
                          canRewind={j === 0 && i < (messages?.length || 0) - 1}
                          onSpeak={(content) => onSpeak(content, subMsg.character_name)}
                          onDeleteMessage={onDeleteMessage ? () => onDeleteMessage(i) : undefined}
                          onRegenerateMessage={!subMsg.role === 'user' && onRegenerateMessage ? () => onRegenerateMessage(i) : undefined}
                        />
                      ),
                    });
        });
        return;
      }
    }

    const msgChar = characters.find(c => c.name === msg.character_name);
    allRendered.push({
      key: String(i),
      element: (
        <MessageBubble
          key={i}
          message={msg}
          character={msgChar}
          characterMemories={characterMemories}
          characterEmotion={characterEmotions?.[msgChar?.id]?.emotion || 'neutral'}
          characterEmotionIntensity={characterEmotions?.[msgChar?.id]?.intensity || 5}
          sessionId={session?.id}
          messageLoreLinks={loreLinks[i] || []}
          onRewind={() => onRewindToMessage(i)}
          canRewind={i < (messages?.length || 0) - 1}
          onSpeak={(content) => onSpeak(content, msg.character_name)}
          onEditMessage={msg.role === 'user' && onEditMessage ? (newText) => onEditMessage(i, newText) : undefined}
          onDeleteMessage={onDeleteMessage ? () => onDeleteMessage(i) : undefined}
          onRegenerateMessage={msg.role === 'assistant' && msg.character_name !== '__typing__' && onRegenerateMessage ? () => onRegenerateMessage(i) : undefined}
        />
      ),
    });
  });

  const total = allRendered.length;
  const hasMore = visibleCount < total;
  const visibleItems = allRendered.slice(total - visibleCount);

  const handleLoadMore = () => {
    setLoading(true);
    setTimeout(() => {
      setVisibleCount(prev => Math.min(prev + PAGE_SIZE, total));
      setLoading(false);
    }, 300);
  };

  return (
    <>
      {/* Load Previous Messages button — sticky at the top of the chat scroll area */}
      <AnimatePresence>
        {hasMore && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="sticky top-0 z-10 flex justify-center py-2 pointer-events-none"
          >
            <button
              onClick={handleLoadMore}
              disabled={loading}
              className="pointer-events-auto flex items-center gap-2 px-5 py-2 border border-primary/50 bg-black/80 backdrop-blur-md text-primary hover:bg-primary/20 hover:border-primary font-mono text-[9px] tracking-widest uppercase transition-all shadow-lg shadow-black/60 disabled:opacity-50"
            >
              {loading ? (
                <Loader className="w-2 h-2 animate-spin" />
              ) : (
                <ChevronUp className="w-2 h-2" />
              )}
              {loading ? "Loading..." : `↑ Previous messages (${total - visibleCount} hidden)`}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Visible messages */}
      {visibleItems.map(item => item.element)}
    </>
  );
}