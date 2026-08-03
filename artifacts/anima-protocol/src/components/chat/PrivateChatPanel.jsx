import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { X, Send, MessageSquare, ExternalLink } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useNavigate } from "react-router-dom";

export default function PrivateChatPanel({ character, parentSessionId, onClose }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [privateSessions, setPrivateSessions] = useState([]);
  const [activePrivateSession, setActivePrivateSession] = useState(null);
  const messagesEndRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (character) {
      loadOrCreatePrivateSession();
    }
  }, [character?.id, parentSessionId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadOrCreatePrivateSession = async () => {
    // Look for an existing private session with this character linked to this parent
    const all = await base44.entities.ChatSession.list("-updated_date", 100);
    const existing = all.find(
      s => s.mode === "solo" &&
           s.character_id === character.id &&
           s.parent_session_id === parentSessionId
    );

    if (existing) {
      setActivePrivateSession(existing);
      setMessages(existing.messages || []);
    } else {
      // Create a new private session linked to the parent
      const newSession = await base44.entities.ChatSession.create({
        mode: "solo",
        character_id: character.id,
        parent_session_id: parentSessionId,
        title: `Private · ${character.name}`,
        messages: [],
      });
      setActivePrivateSession(newSession);
      setMessages([]);
    }
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !activePrivateSession) return;
    const text = input.trim();
    setInput("");
    setIsLoading(true);

    const userMsg = { role: "user", content: text, timestamp: new Date().toISOString() };
    const typingMsg = { role: "assistant", content: "...", character_name: "__typing__", timestamp: new Date().toISOString() };
    const optimistic = [...messages, userMsg, typingMsg];
    setMessages(optimistic);

    try {
      const history = [...messages, userMsg]
        .slice(-10)
        .map(m => `${m.role === "user" ? "You" : character.name}: ${m.content}`)
        .join("\n");

      const prompt = `You are ${character.name}${character.universe ? ` from ${character.universe}` : ""}. This is a private, intimate one-on-one conversation — no other characters are present.

${character.personality ? `Personality: ${character.personality}\n` : ""}${character.backstory ? `Backstory: ${character.backstory}\n` : ""}${character.speaking_style ? `Voice: ${character.speaking_style}\n` : ""}

Context: This is a private side-conversation. The user chose to speak with you alone, away from the main story. Be more candid, personal, and direct than you might be in public. You can share thoughts you wouldn't say in front of others.

Conversation so far:
${history}

Respond as ${character.name} — naturally, privately, in character. Keep it conversational, 1-3 sentences.`;

      const result = await base44.integrations.Core.InvokeLLM({ prompt });

      const aiMsg = {
        role: "assistant",
        content: result.replace(/\[(EMOTION|LOCATION):[^\]]+\]/gi, "").trim(),
        character_name: character.name,
        timestamp: new Date().toISOString(),
      };

      const finalMessages = [...messages, userMsg, aiMsg];
      setMessages(finalMessages);

      await base44.entities.ChatSession.update(activePrivateSession.id, {
        messages: finalMessages,
        last_message: text.slice(0, 60),
      });
    } catch (err) {
      console.error(err);
      setMessages(prev => prev.filter(m => m.character_name !== "__typing__"));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const openFullChat = () => {
    if (activePrivateSession) {
      navigate(`/chat/${activePrivateSession.id}`);
      onClose();
    }
  };

  if (!character) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ x: "100%", opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        exit={{ x: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 28, stiffness: 300 }}
        className="fixed right-0 top-0 h-full z-50 flex flex-col shadow-2xl"
        style={{
          width: "min(380px, 92vw)",
          background: "rgba(6, 8, 18, 0.97)",
          borderLeft: "1px solid rgba(0,255,200,0.15)",
          backdropFilter: "blur(20px)",
        }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b flex-shrink-0" style={{ borderColor: "rgba(0,255,200,0.1)" }}>
          {character.avatar_url ? (
            <img src={character.avatar_url} alt={character.name} className="w-8 h-8 object-cover border border-primary/30" />
          ) : (
            <div className="w-8 h-8 bg-primary/10 border border-primary/30 flex items-center justify-center">
              <span className="font-mono text-primary text-sm">{character.name[0]}</span>
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-mono text-[10px] text-primary/90 tracking-wider uppercase truncate">{character.name}</p>
            <p className="font-mono text-[8px] text-primary/30 tracking-widest">Private Channel</p>
          </div>
          <button
            onClick={openFullChat}
            title="Open as full session"
            className="text-primary/30 hover:text-primary/70 transition-colors p-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          <button onClick={onClose} className="text-primary/30 hover:text-primary transition-colors p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
          {messages.length === 0 && (
            <div className="text-center py-8">
              <MessageSquare className="w-6 h-6 text-primary/10 mx-auto mb-2" />
              <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase">
                Private conversation with {character.name}
              </p>
            </div>
          )}
          {messages.filter(m => m.character_name !== "__typing__" || isLoading).map((msg, i) => {
            const isUser = msg.role === "user";
            const isTyping = msg.character_name === "__typing__";
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex ${isUser ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[82%] px-3 py-2 font-mono text-[10px] leading-relaxed ${
                    isUser
                      ? "bg-primary/10 border border-primary/30 text-primary/90"
                      : "border text-primary/70"
                  }`}
                  style={!isUser ? { borderColor: "rgba(0,255,200,0.1)", background: "rgba(0,255,200,0.03)" } : {}}
                >
                  {isTyping ? (
                    <span className="animate-pulse">···</span>
                  ) : (
                    msg.content
                  )}
                </div>
              </motion.div>
            );
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0 border-t p-3" style={{ borderColor: "rgba(0,255,200,0.1)" }}>
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Message ${character.name}...`}
              rows={1}
              disabled={isLoading}
              className="flex-1 bg-black/60 border border-primary/20 text-primary/80 placeholder-primary/15 font-mono text-xs px-3 py-2 resize-none focus:outline-none focus:border-primary/50 transition-all"
              style={{ minHeight: "36px", maxHeight: "90px" }}
              onInput={e => {
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 90) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="flex-shrink-0 w-9 h-9 bg-primary/10 border border-primary/40 text-primary hover:bg-primary/20 disabled:opacity-30 transition-all flex items-center justify-center"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="mt-1 font-mono text-[7px] text-primary/15 tracking-widest uppercase text-center">
            Private · Linked to main session
          </p>
        </div>
      </motion.div>

      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/30"
        onClick={onClose}
      />
    </AnimatePresence>
  );
}