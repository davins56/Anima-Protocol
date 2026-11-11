import { useLayoutEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import SystemDisclosure from "./SystemDisclosure";
import NarratorBubble from "./NarratorBubble";
import { isNarratorMessage } from "@/lib/storyNarrator";
import { parseGroupResponse } from "@/lib/parseGroupResponse";
import { lastReplyActionIndexes } from "@/lib/chatReplyActions";
import { mayHaveOlderMessages, oldestSeq } from "@/lib/olderMessages";
import { ChevronUp, Loader } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export const PAGE_SIZE = 20; // messages shown per "page"
const EMPTY = Object.freeze([]);

// parseGroupResponse per (message object, group roster). Settled messages keep
// their identity across renders, so the split sub-messages do too and the
// memoized bubbles below can skip re-rendering while a new reply streams in.
const splitCache = new WeakMap();
function splitGroupMessage(msg, groupChars, rosterKey) {
  let byRoster = splitCache.get(msg);
  if (!byRoster) {
    byRoster = new Map();
    splitCache.set(msg, byRoster);
  }
  if (!byRoster.has(rosterKey)) {
    byRoster.set(rosterKey, parseGroupResponse(msg.content, groupChars, msg.character_name));
  }
  return byRoster.get(rosterKey);
}

/**
 * Per-index callbacks with a stable identity that always call the latest
 * handler from props, so React.memo(MessageBubble) is not defeated by the
 * inline arrows Chat.jsx and this list used to create on every render.
 */
function useIndexedCallbacks(latest) {
  const cache = useRef(new Map());
  return (key, make) => {
    let fn = cache.current.get(key);
    if (!fn) {
      fn = make(latest);
      cache.current.set(key, fn);
    }
    return fn;
  };
}

export default function MessageList({ messages, session, characters, characterMemories = EMPTY, characterEmotions, loreLinks, onRewindToMessage, onSpeak, onEditMessage, onDeleteMessage, onRegenerateMessage, onAvatarClick, onTeachMessage, onRateMessage, onLoadOlder, scrollContainerRef, actionsDisabled = false }) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(false);
  const [serverExhausted, setServerExhausted] = useState(false);
  const anchorRef = useRef(null);

  const rows = messages || EMPTY;
  const groupChars = session?.mode === "group"
    ? characters.filter(c => session.group_character_ids?.includes(c.id))
    : EMPTY;
  const rosterKey = groupChars.map((c) => `${c.id}:${c.name}`).join("|");

  const latest = useRef(null);
  latest.current = { messages: rows, groupChars, rosterKey, onRewindToMessage, onSpeak, onEditMessage, onDeleteMessage, onRegenerateMessage, onTeachMessage, onRateMessage };
  const cb = useIndexedCallbacks(latest);
  const { lastUser, lastAssistant } = lastReplyActionIndexes(rows);
  const askAgainFromUser = lastUser >= 0 && lastAssistant < lastUser;

  // Only the visible window is turned into elements. Older rows stay data
  // until "Previous messages" reveals them.
  const start = Math.max(0, rows.length - visibleCount);
  const canFetchOlder = Boolean(onLoadOlder) && !serverExhausted && start === 0 && mayHaveOlderMessages(rows);
  const hasMore = start > 0 || canFetchOlder;

  // Keep the reader's place when rows are added above them.
  useLayoutEffect(() => {
    const pending = anchorRef.current;
    const el = scrollContainerRef?.current;
    if (!pending || !el) return;
    anchorRef.current = null;
    el.scrollTop = pending.top + (el.scrollHeight - pending.height);
  }, [start, rows.length, scrollContainerRef]);

  const rememberAnchor = () => {
    const el = scrollContainerRef?.current;
    anchorRef.current = el ? { top: el.scrollTop, height: el.scrollHeight } : null;
  };

  const handleLoadMore = async () => {
    if (loading) return;
    if (start > 0) {
      // Already loaded: reveal the next page at once (no artificial delay).
      rememberAnchor();
      setVisibleCount(prev => prev + PAGE_SIZE);
      return;
    }
    if (!canFetchOlder) return;
    setLoading(true);
    try {
      const result = await onLoadOlder(oldestSeq(rows));
      if (result?.exhausted) setServerExhausted(true);
      if (result?.fetched > 0) {
        rememberAnchor();
        setVisibleCount(prev => prev + Math.min(result.fetched, PAGE_SIZE));
      }
    } catch {
      // Leave the button so the reader can try again.
    } finally {
      setLoading(false);
    }
  };

  const elements = [];
  for (let i = start; i < rows.length; i += 1) {
    const msg = rows[i];
    if (msg?.type === "crisis_resource" || msg?.type === "ai_notice" || msg?.role === "system") {
      elements.push(
        <SystemDisclosure
          key={`disclosure-${i}`}
          tone={msg.type === "crisis_resource" ? "crisis" : "info"}
          text={msg.content}
          testId={
            msg.type === "crisis_resource"
              ? "crisis-resource-card"
              : msg.type === "resting_notice"
                ? "resting-notice"
                : "ai-companion-notice"
          }
        />,
      );
      continue;
    }
    if (isNarratorMessage(msg)) {
      elements.push(
        <NarratorBubble
          key={`narration-${i}`}
          message={msg}
          onDelete={onDeleteMessage ? cb(`delete:${i}`, (l) => () => l.current.onDeleteMessage?.(i)) : undefined}
          actionsDisabled={actionsDisabled}
        />,
      );
      continue;
    }
    if (
      msg.role === "assistant" &&
      msg.character_name !== "__typing__" &&
      msg.type !== "event" &&
      groupChars.length > 0 &&
      /\*\*[^*:]+\*\*:/.test(msg.content || "")
    ) {
      const split = splitGroupMessage(msg, groupChars, rosterKey);
      if (split.length > 1) {
        split.forEach((subMsg, j) => {
          const subChar = characters.find(c => c.name === subMsg.character_name);
          elements.push(
            <MessageBubble
              key={`${i}-${j}`}
              message={subMsg}
              character={subChar}
              characterMemories={characterMemories}
              characterEmotion={characterEmotions?.[subChar?.id]?.emotion || 'neutral'}
              characterEmotionIntensity={characterEmotions?.[subChar?.id]?.intensity || 5}
              onRewind={j === 0 ? cb(`rewind:${i}`, (l) => () => l.current.onRewindToMessage(i)) : undefined}
              canRewind={j === 0 && i < rows.length - 1}
              onSpeak={cb(`speak:${subMsg.character_name}`, (l) => (content) => l.current.onSpeak(content, subMsg.character_name))}
              onDeleteMessage={onDeleteMessage ? cb(`delete:${i}`, (l) => () => l.current.onDeleteMessage?.(i)) : undefined}
              onRegenerateMessage={subMsg.role !== "user" && onRegenerateMessage ? cb(`regen:${i}`, (l) => () => l.current.onRegenerateMessage?.(i)) : undefined}
              showRetry={j === 0 && i === lastAssistant}
              actionsDisabled={actionsDisabled}
              onAvatarClick={onAvatarClick}
              onTeach={onTeachMessage ? cb(`teach:${i}:${j}`, (l) => () => {
                const cur = l.current;
                const row = cur.messages[i];
                const latestSub = (row ? splitGroupMessage(row, cur.groupChars, cur.rosterKey)[j] : null) || subMsg;
                cur.onTeachMessage?.(i, latestSub, j);
              }) : undefined}
            />,
          );
        });
        continue;
      }
    }

    const msgChar = characters.find(c => c.name === msg.character_name);
    elements.push(
      <MessageBubble
        key={i}
        message={msg}
        character={msgChar}
        characterMemories={characterMemories}
        characterEmotion={characterEmotions?.[msgChar?.id]?.emotion || 'neutral'}
        characterEmotionIntensity={characterEmotions?.[msgChar?.id]?.intensity || 5}
        sessionId={session?.id}
        messageLoreLinks={loreLinks?.[i] || EMPTY}
        onRewind={cb(`rewind:${i}`, (l) => () => l.current.onRewindToMessage(i))}
        canRewind={i < rows.length - 1}
        onSpeak={cb(`speak:${msg.character_name}`, (l) => (content) => l.current.onSpeak(content, msg.character_name))}
        onEditMessage={msg.role === 'user' && onEditMessage ? cb(`edit:${i}`, (l) => (newText) => l.current.onEditMessage?.(i, newText)) : undefined}
        onDeleteMessage={onDeleteMessage ? cb(`delete:${i}`, (l) => () => l.current.onDeleteMessage?.(i)) : undefined}
        onRegenerateMessage={
          onRegenerateMessage && msg.role === "assistant" && msg.character_name !== "__typing__"
            ? cb(`regen:${i}`, (l) => () => l.current.onRegenerateMessage?.(i))
            : onRegenerateMessage && askAgainFromUser && i === lastUser
              ? cb("regen:askAgain", (l) => () => l.current.onRegenerateMessage?.(l.current.messages?.length || 0))
              : undefined
        }
        showEdit={msg.role === "user" && i === lastUser}
        showRetry={
          (msg.role === "assistant" && i === lastAssistant) ||
          (askAgainFromUser && i === lastUser)
        }
        actionsDisabled={actionsDisabled}
        onAvatarClick={onAvatarClick}
        onTeach={msg.role === 'assistant' && onTeachMessage ? cb(`teach:${i}`, (l) => () => l.current.onTeachMessage?.(i)) : undefined}
        onRate={msg.role === 'assistant' && onRateMessage ? cb(`rate:${i}`, (l) => (rating, better, extra) => l.current.onRateMessage?.(i, rating, better, extra)) : undefined}
      />,
    );
  }

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
              {loading
                ? "Loading..."
                : start > 0
                  ? `↑ Previous messages (${start} hidden)`
                  : "↑ Earlier messages"}
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Visible messages */}
      {elements}
    </>
  );
}
