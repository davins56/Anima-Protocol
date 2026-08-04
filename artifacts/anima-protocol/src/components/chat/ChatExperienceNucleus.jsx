import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, LoaderCircle } from "lucide-react";
import ChatInput from "./ChatInput";
import MessageList from "./MessageList";
import { useChatNucleus } from "@/hooks/useChatNucleus";

export default function ChatExperienceNucleus({
  sessionId,
  initialMessages = [],
  characters = [],
  activeCharacter = null,
  mode = "solo",
  className = "",
}) {
  const {
    session,
    messages,
    isLoading,
    error,
    providerStatus,
    sendMessage,
  } = useChatNucleus({
    sessionId,
    initialMessages,
    characters,
    activeCharacter,
    mode,
  });

  return (
    <div className={`flex h-full min-h-0 flex-col bg-black/40 ${className}`.trim()}>
      <div className="flex items-center justify-between border-b border-primary/20 bg-black/50 px-4 py-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.35em] text-primary/70">
            Chat nucleus
          </p>
          <p className="text-sm text-primary/70">
            {mode === "group" ? "Group conversation" : "Single companion"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.3em] text-primary/50">
          {isLoading ? (
            <span className="flex items-center gap-2">
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              Thinking
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="h-3.5 w-3.5" />
              Ready
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        <AnimatePresence initial={false}>
          <MessageList
            messages={messages}
            session={session}
            characters={characters}
            characterMemories={[]}
            characterEmotions={{}}
            loreLinks={{}}
            onRewindToMessage={() => {}}
            onSpeak={() => {}}
            onEditMessage={() => {}}
            onDeleteMessage={() => {}}
            onRegenerateMessage={() => {}}
          />
        </AnimatePresence>
      </div>

      {error ? (
        <div className="border-t border-destructive/40 bg-destructive/10 px-4 py-2 text-[11px] text-destructive">
          {error}
        </div>
      ) : null}

      {providerStatus ? (
        <div className="border-t border-primary/10 bg-black/30 px-4 py-2 text-[10px] uppercase tracking-[0.3em] text-primary/50">
          Provider: {providerStatus}
        </div>
      ) : null}

      <ChatInput onSend={sendMessage} isLoading={isLoading} disabled={false} />
    </div>
  );
}
