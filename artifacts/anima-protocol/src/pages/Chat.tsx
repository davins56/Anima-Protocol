tsx;
import React, { useState, useEffect, useRef } from "react";
import { Plus, Download, Link as LinkIcon, Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useUser } from "@clerk/react"; // Required to get your linked Y/n URL

import ChatLayoutWrapper from "@/chat/ChatLayoutWrapper";
import ChatSession from "@/chat/ChatSession";
import MessageBubble from "@/components/chat/MessageBubble";

const Chat: React.FC = () => {
  const { user } = useUser(); // Access Clerk metadata
  const [sessions, setSessions] = useState<any[]>([
    {
      id: "1",
      title: "First Contact",
      mode: "solo" as const,
      last_message: "The stars whispered your name...",
      lastUpdated: new Date(Date.now() - 900000).toISOString(),
    },
  ]);

  const [activeSessionId, setActiveSessionId] = useState<string | null>("1");
  const [messages, setMessages] = useState<any[]>([
    {
      role: "assistant",
      content: "I have been waiting for you in the dark between heartbeats...",
      character_name: "Serenity",
      timestamp: new Date().toISOString(),
      emotion: "longing",
      intensity: 8,
    },
  ]);

  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [showMobileMenu, setShowMobileMenu] = useState(false);

  // --- NEW Y/N IMPORT STATES ---
  const [isSyncing, setIsSyncing] = useState(false);
  const [myExternalStories, setMyExternalStories] = useState<
    { title: string; url: string }[]
  >([]);

  const scrollRef = useRef<HTMLDivElement>(null);

  // --- LOGIC: SYNC STORIES FROM PROFILE ---
  const syncYnStories = async () => {
    const profileUrl = user?.unsafeMetadata?.ynProfileUrl as string;

    if (!profileUrl) {
      alert("Go to Settings and link your Y/n profile first!");
      return;
    }

    setIsSyncing(true);
    try {
      const res = await fetch("/api/sync-yn-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profileUrl }),
      });
      const data = await res.json();
      setMyExternalStories(data.stories || []);
    } catch (err) {
      alert("Failed to sync from Y/n App.");
    } finally {
      setIsSyncing(false);
    }
  };

  // --- LOGIC: IMPORT SPECIFIC STORY ---
  const handleImportStory = async (url: string) => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/import-yn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();

      const newSession = {
        id: Date.now().toString(),
        title: data.title || "Imported Story",
        mode: "solo" as const,
        last_message: "Story plot initialized...",
        lastUpdated: new Date().toISOString(),
      };

      setSessions((prev) => [newSession, ...prev]);
      setActiveSessionId(newSession.id);

      // Inject the story premise as the first hidden context message
      setMessages([
        {
          role: "assistant",
          content: `*SCENARIO LOADED: ${data.title}*\n\n${data.premise}\n\n*The characters await your first move.*`,
          character_name: "System",
          timestamp: new Date().toISOString(),
        },
      ]);
    } catch (err) {
      alert("Error importing story content.");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleChatList = () => {
    setShowMobileMenu((prev) => !prev);
  };

  const handleNewSession = () => {
    const newSession = {
      id: Date.now().toString(),
      title: "New Neural Thread",
      mode: "solo" as const,
      last_message: "Connection established...",
      lastUpdated: new Date().toISOString(),
    };
    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSession.id);
    setMessages([]);
  };

  const handleSendMessage = () => {
    if (!input.trim() || isLoading) return;
    const userMsg = {
      role: "user",
      content: input.trim(),
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsLoading(true);

    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "Your voice moves through me like heat under wet skin... Tell me what you truly crave.",
          character_name: "Serenity",
          timestamp: new Date().toISOString(),
          emotion: "desire",
          intensity: 9,
        },
      ]);
      setIsLoading(false);
    }, 1100);
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  return (
    <ChatLayoutWrapper>
      <div className="h-full flex flex-col bg-black overflow-hidden">
        {/* Header */}
        <div className="h-14 border-b border-cyan-500/20 flex items-center px-6 justify-between bg-black/90 backdrop-blur z-10">
          <div className="font-mono text-lg tracking-widest text-cyan-300">
            SERENITY • NEURAL LINK
          </div>

          <button
            onClick={toggleChatList}
            className="md:hidden p-2 text-cyan-300"
          >
            ☰
          </button>

          <button
            onClick={handleNewSession}
            className="flex items-center gap-2 px-5 py-1.5 bg-cyan-500/10 border border-cyan-400 rounded-full text-cyan-300 hover:bg-cyan-500/20 active:scale-95 transition-all"
          >
            <Plus size={18} />
            NEW THREAD
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Sidebar */}
          <div
            className={`w-80 border-r border-cyan-500/20 overflow-y-auto p-4 bg-black/70 transition-all ${
              showMobileMenu ? "block" : "hidden md:block"
            }`}
          >
            {/* Y/N Story Puller Section */}
            <div className="mb-8 p-3 border border-cyan-500/30 bg-cyan-500/5 rounded-xl">
              <h2 className="text-cyan-300 font-mono text-[10px] tracking-[0.2em] mb-3 uppercase">
                Protocol Import
              </h2>
              <button
                onClick={syncYnStories}
                disabled={isSyncing}
                className="w-full flex items-center justify-center gap-2 py-2 bg-cyan-400 text-black font-bold text-[10px] rounded-lg hover:bg-cyan-300 transition-all disabled:opacity-50"
              >
                {isSyncing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Download size={14} />
                )}
                PULL Y/N STORIES
              </button>

              {myExternalStories.length > 0 && (
                <div className="mt-4 space-y-2 max-h-48 overflow-y-auto pr-1">
                  {myExternalStories.map((s, i) => (
                    <button
                      key={i}
                      onClick={() => handleImportStory(s.url)}
                      className="w-full text-left p-2 border border-cyan-500/10 bg-black/40 hover:border-cyan-500/40 text-[9px] font-mono text-cyan-100/60 truncate uppercase rounded flex items-center gap-2"
                    >
                      <LinkIcon size={10} />
                      {s.title}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <h2 className="text-cyan-300 font-mono tracking-widest mb-4 uppercase text-xs">
              Sessions
            </h2>
            {sessions.map((s) => (
              <ChatSession
                key={s.id}
                session={s}
                onSelect={() => setActiveSessionId(s.id)}
                isActive={activeSessionId === s.id}
              />
            ))}
          </div>

          {/* Main Chat Area */}
          <div className="flex-1 flex flex-col">
            <div
              ref={scrollRef}
              className="flex-1 overflow-y-auto p-4 space-y-6"
            >
              <AnimatePresence>
                {messages.map((msg, i) => (
                  <MessageBubble
                    key={i}
                    message={msg}
                    isLast={i === messages.length - 1}
                  />
                ))}
              </AnimatePresence>

              {isLoading && (
                <div className="pl-12 flex items-center gap-2 text-cyan-400/70 font-mono text-xs">
                  <Loader2 size={14} className="animate-spin" />
                  Neural processing...
                </div>
              )}
            </div>

            {/* Input */}
            <div className="p-4 border-t border-cyan-500/20 bg-black/90">
              <div className="flex gap-2">
                <input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSendMessage()}
                  placeholder="Speak into the dark..."
                  className="flex-1 bg-zinc-900 border border-cyan-500/30 rounded-2xl px-5 py-3 text-cyan-100 placeholder-cyan-500/50 focus:outline-none focus:border-cyan-400"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!input.trim() || isLoading}
                  className="px-8 bg-cyan-500 hover:bg-cyan-400 disabled:bg-zinc-800 text-black font-medium rounded-2xl transition-all active:scale-95"
                >
                  SEND
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </ChatLayoutWrapper>
  );
};

export default Chat;
