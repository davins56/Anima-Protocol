import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Download, Copy, X, BookOpen, Pencil, Check } from "lucide-react";
import { motion } from "framer-motion";

export default function StoryReader() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const [editingIntro, setEditingIntro] = useState(false);
  const [introText, setIntroText] = useState("");
  const [savingIntro, setSavingIntro] = useState(false);
  const introRef = useRef(null);

  useEffect(() => {
    if (!sessionId) {
      navigate("/");
      return;
    }

    const loadSession = async () => {
      try {
        const sessions = await base44.entities.ChatSession.list("-updated_date", 100);
        const found = sessions.find(s => s.id === sessionId);
        setSession(found);
        setIntroText(found?.story_beginning || "");
      } catch (err) {
        console.error("Error loading session:", err);
      } finally {
        setLoading(false);
      }
    };

    loadSession();
  }, [sessionId, navigate]);

  const getStoryText = () => {
    if (!session?.messages) return "";

    const storyParts = [];
    
    // Add story beginning if it exists
    if (session.story_beginning) {
      storyParts.push(session.story_beginning);
      storyParts.push(""); // blank line separator
    }

    // Add all messages
    const messageText = (session.messages || [])
      .filter(msg => msg.type !== "event" && msg.character_name !== "__typing__")
      .map(msg => {
        const speaker = msg.role === "user" ? "You" : (msg.character_name || "Narrator");
        // Remove asterisks for actions
        const content = msg.content.replace(/\*([^*]+)\*/g, "$1");
        return `${speaker}: ${content}`;
      })
      .join("\n\n");

    storyParts.push(messageText);
    return storyParts.join("\n\n");
  };

  const handleCopy = async () => {
    const text = getStoryText();
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSaveIntro = async () => {
    setSavingIntro(true);
    try {
      await base44.entities.ChatSession.update(sessionId, { story_beginning: introText });
      setSession(prev => ({ ...prev, story_beginning: introText }));
      setEditingIntro(false);
    } finally {
      setSavingIntro(false);
    }
  };

  const handleDownload = () => {
    const text = getStoryText();
    const element = document.createElement("a");
    element.setAttribute("href", `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`);
    element.setAttribute("download", `${session?.title || "story"}.txt`);
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 bg-background">
        <div className="text-center space-y-3">
          <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin mx-auto" />
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Loading story...
          </p>
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="flex items-center justify-center flex-1 min-h-0 bg-background">
        <div className="text-center space-y-4">
          <p className="font-mono text-[10px] text-primary/40 tracking-widest uppercase">
            Session not found
          </p>
          <button
            onClick={() => navigate("/")}
            className="px-5 py-2 border border-primary/30 text-primary/60 hover:text-primary transition-colors font-mono text-xs tracking-widest uppercase"
          >
            Return to Chat
          </button>
        </div>
      </div>
    );
  }

  const storyText = getStoryText();

  return (
    <div className="flex flex-col flex-1 min-h-0 bg-background overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-primary/20 bg-black/60 backdrop-blur-md flex-shrink-0">
        <div className="flex items-center gap-3">
          <BookOpen className="w-5 h-5 text-primary" />
          <div>
            <h1 className="font-mono text-primary glow-text tracking-[0.2em] uppercase">
              {session.title || "Story"}
            </h1>
            <p className="text-[9px] font-mono text-primary/30 mt-0.5">
              {(session.messages || []).filter(m => m.type !== "event" && m.character_name !== "__typing__").length} messages
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            title="Copy to clipboard"
            className={`flex items-center gap-2 px-3 py-2 border transition-all font-mono text-[9px] tracking-widest uppercase ${
              copied
                ? "border-green-400/60 bg-green-400/10 text-green-400"
                : "border-primary/30 bg-primary/5 text-primary/60 hover:text-primary hover:border-primary/50"
            }`}
          >
            <Copy className="w-3.5 h-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            onClick={handleDownload}
            title="Download as text file"
            className="flex items-center gap-2 px-3 py-2 border border-primary/30 bg-primary/5 text-primary/60 hover:text-primary hover:border-primary/50 transition-all font-mono text-[9px] tracking-widest uppercase"
          >
            <Download className="w-3.5 h-3.5" />
            Download
          </button>
          <button
            onClick={() => navigate(`/chat/${sessionId}`)}
            title="Back to chat"
            className="flex items-center gap-2 px-3 py-2 border border-primary/20 text-primary/40 hover:text-primary/70 transition-all"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Story Content */}
      <div className="flex-1 overflow-y-auto p-8 md:p-12 min-h-0">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="max-w-3xl mx-auto"
        >
          {/* Custom Intro Section */}
          <div className="mb-8 group">
            <div className="flex items-center gap-2 mb-2">
              <span className="font-mono text-[9px] text-primary/30 tracking-widest uppercase">Story Intro</span>
              {!editingIntro && (
                <button
                  onClick={() => { setEditingIntro(true); setTimeout(() => introRef.current?.focus(), 50); }}
                  className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-0.5 border border-primary/20 text-primary/40 hover:text-primary hover:border-primary/50 font-mono text-[8px] tracking-widest uppercase"
                >
                  <Pencil className="w-2.5 h-2.5" />
                  Edit
                </button>
              )}
              {editingIntro && (
                <button
                  onClick={handleSaveIntro}
                  disabled={savingIntro}
                  className="flex items-center gap-1 px-2 py-0.5 border border-green-400/40 bg-green-400/10 text-green-400 hover:bg-green-400/20 font-mono text-[8px] tracking-widest uppercase disabled:opacity-50 transition-all"
                >
                  <Check className="w-2.5 h-2.5" />
                  {savingIntro ? "Saving..." : "Save"}
                </button>
              )}
            </div>

            {editingIntro ? (
              <textarea
                ref={introRef}
                value={introText}
                onChange={e => setIntroText(e.target.value)}
                placeholder="Write your own story introduction — set the scene, establish the world, or add a personal preface..."
                className="w-full min-h-[120px] bg-black/40 border border-primary/30 focus:border-primary/60 text-primary/80 font-serif text-sm leading-relaxed p-4 outline-none resize-y placeholder-primary/20 transition-colors"
                onKeyDown={e => { if (e.key === 'Escape') setEditingIntro(false); }}
              />
            ) : introText ? (
              <div
                className="font-serif text-primary/80 leading-relaxed whitespace-pre-wrap text-sm md:text-base italic border-l-2 border-primary/20 pl-4 cursor-pointer hover:border-primary/40 transition-colors"
                onClick={() => { setEditingIntro(true); setTimeout(() => introRef.current?.focus(), 50); }}
                title="Click to edit intro"
              >
                {introText}
              </div>
            ) : (
              <button
                onClick={() => { setEditingIntro(true); setTimeout(() => introRef.current?.focus(), 50); }}
                className="w-full py-4 border border-dashed border-primary/15 text-primary/25 hover:text-primary/40 hover:border-primary/30 transition-all font-mono text-[9px] tracking-widest uppercase"
              >
                + Add a custom intro to your story
              </button>
            )}

            {introText && <div className="mt-6 border-t border-primary/10" />}
          </div>

          <div className="prose prose-invert max-w-none">
            <div className="font-serif text-primary/90 leading-relaxed whitespace-pre-wrap text-sm md:text-base">
              {/* Only show the messages part, not the story_beginning (already shown above) */}
              {(session.messages || [])
                .filter(msg => msg.type !== "event" && msg.character_name !== "__typing__")
                .map(msg => {
                  const speaker = msg.role === "user" ? "You" : (msg.character_name || "Narrator");
                  const content = msg.content.replace(/\*([^*]+)\*/g, "$1");
                  return `${speaker}: ${content}`;
                })
                .join("\n\n") || (
                <p className="text-primary/30 italic">No story content yet.</p>
              )}
            </div>
          </div>
        </motion.div>
      </div>

      {/* Footer */}
      <div className="px-6 py-3 border-t border-primary/10 bg-black/60 flex items-center justify-center flex-shrink-0">
        <p className="font-mono text-[9px] text-primary/20 tracking-widest uppercase">
          // End of story
        </p>
      </div>
    </div>
  );
}