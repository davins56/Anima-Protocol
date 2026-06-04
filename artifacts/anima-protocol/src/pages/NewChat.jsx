import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import NewSessionModal from "@/components/chat/NewSessionModal";
import StoryCharacterChooser from "@/components/stories/StoryCharacterChooser";
import { Plus, ChevronLeft } from "lucide-react";

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function NewChat() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState(null);
  const [creating, setCreating] = useState(false);
  const [showModeSelect, setShowModeSelect] = useState(false);
  const [showStory, setShowStory] = useState(false);

  useEffect(() => {
    base44.entities.ChatSession.list("-updated_date", 50)
      .then(data => setSessions(data || []))
      .catch(() => setSessions([]))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async ({ mode: m, character_id, group_character_ids, opening_scene }) => {
    setCreating(true);
    try {
      let title = "New Session";
      let initialMessages = [];

      if (m === "solo" && character_id) {
        const chars = await base44.entities.Character.list("-created_date", 500);
        const animas = await base44.entities.Anima.list("-created_date", 100);
        const all = [...(chars || []), ...(animas || [])];
        const char = all.find((c) => c.id === character_id);
        title = char ? char.name : "New Session";
      } else if (m === "group" && group_character_ids?.length) {
        const chars = await base44.entities.Character.list("-created_date", 500);
        const animas = await base44.entities.Anima.list("-created_date", 100);
        const all = [...(chars || []), ...(animas || [])];
        const groupChars = all.filter((c) => group_character_ids.includes(c.id));
        title =
          groupChars.slice(0, 2).map((c) => c.name).join(", ") +
          (groupChars.length > 2 ? ` +${groupChars.length - 2}` : "");
        const charNames = groupChars.map((c) => c.name).join(", ");
        initialMessages = [
          {
            role: "assistant",
            character_name: "Narrator",
            content: `The stage is set. ${charNames} find themselves drawn together by fate or circumstance. The air crackles with potential as these extraordinary beings come face to face. What unfolds next will alter the course of events. The scene awaits...`,
            timestamp: new Date().toISOString(),
          },
        ];
      }

      const newSession = await base44.entities.ChatSession.create({
        mode: m,
        character_id: character_id || null,
        group_character_ids: group_character_ids || [],
        title,
        messages: initialMessages,
        opening_scene: opening_scene || null,
      });

      if (initialMessages.length > 0) {
        await base44.entities.ChatSession.update(newSession.id, { messages: initialMessages });
      }

      navigate(`/chat/${newSession.id}`, { replace: true });
    } catch (err) {
      console.error("Failed to create session:", err);
      setCreating(false);
      setMode(null);
      setShowModeSelect(false);
    }
  };

  if (creating) {
    return (
      <div className="flex flex-col items-center justify-center h-full w-full gap-3 bg-[#090912]">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
        <p className="font-mono text-xs text-primary/50 tracking-widest uppercase">Initializing session...</p>
      </div>
    );
  }

  if (showStory) {
    return (
      <StoryCharacterChooser
        onClose={() => setShowStory(false)}
        onCreateSession={(session) => navigate(`/chat/${session.id}`)}
      />
    );
  }

  if (showModeSelect && mode) {
    return (
      <div className="flex flex-col h-full bg-[#090912]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/15">
          <button
            onClick={() => { setShowModeSelect(false); setMode(null); }}
            className="text-primary/50 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div>
            <span className="font-mono text-[10px] tracking-[0.3em] text-primary/40 uppercase">// Chat</span>
            <span className="font-mono text-[10px] tracking-[0.3em] text-primary/20 uppercase ml-2">New Session</span>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          <NewSessionModal
            mode={mode}
            onClose={() => { setShowModeSelect(false); setMode(null); }}
            onCreate={handleCreate}
          />
        </div>
      </div>
    );
  }

  if (showModeSelect) {
    return (
      <div className="flex flex-col h-full bg-[#090912]">
        <div className="flex items-center gap-3 px-4 py-3 border-b border-primary/15">
          <button
            onClick={() => setShowModeSelect(false)}
            className="text-primary/50 hover:text-primary transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="font-mono text-[10px] tracking-[0.3em] text-primary/50 uppercase">// New Session</span>
        </div>
        <div className="flex flex-col gap-px p-px bg-primary/5 m-4">
          <button
            onClick={() => setMode("solo")}
            className="flex items-center gap-5 p-5 bg-[#090912] hover:bg-primary/5 transition-all text-left border-b border-primary/10"
          >
            <span className="w-10 h-10 flex items-center justify-center border border-primary/20 text-primary/60 font-mono text-lg">1</span>
            <div>
              <div className="font-mono text-sm tracking-[0.2em] uppercase text-primary">Solo</div>
              <div className="text-primary/40 text-[11px] mt-0.5 font-mono">One-on-one with a character</div>
            </div>
          </button>
          <button
            onClick={() => setMode("group")}
            className="flex items-center gap-5 p-5 bg-[#090912] hover:bg-primary/5 transition-all text-left border-b border-primary/10"
          >
            <span className="w-10 h-10 flex items-center justify-center border border-primary/20 text-primary/60 font-mono text-lg">+</span>
            <div>
              <div className="font-mono text-sm tracking-[0.2em] uppercase text-primary">Group</div>
              <div className="text-primary/40 text-[11px] mt-0.5 font-mono">Multi-character ensemble</div>
            </div>
          </button>
          <button
            onClick={() => setShowStory(true)}
            className="flex items-center gap-5 p-5 bg-[#090912] hover:bg-primary/5 transition-all text-left"
          >
            <span className="w-10 h-10 flex items-center justify-center border border-primary/20 text-primary/60 font-mono text-lg">✦</span>
            <div>
              <div className="font-mono text-sm tracking-[0.2em] uppercase text-primary">Story</div>
              <div className="text-primary/40 text-[11px] mt-0.5 font-mono">Drop a character into a series scene</div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#090912] overflow-hidden">
      {/* Header matching video frame 4 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-primary/15 flex-shrink-0">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] text-primary/30 tracking-widest">▢ //</span>
            <span className="font-mono text-sm tracking-[0.3em] text-primary uppercase glow-text">Chat</span>
          </div>
          <p className="font-mono text-[9px] tracking-[0.25em] text-primary/25 uppercase mt-0.5">Sessions</p>
        </div>
        <button
          onClick={() => setShowModeSelect(true)}
          className="flex items-center gap-1.5 px-3 py-1.5 border border-primary/30 bg-primary/5 hover:bg-primary/10 hover:border-primary/50 transition-all font-mono text-[10px] tracking-[0.2em] uppercase text-primary"
        >
          <Plus className="w-3 h-3" />
          New
        </button>
      </div>

      {/* Sessions section header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-primary/8 flex-shrink-0">
        <span className="font-mono text-[8px] tracking-[0.3em] text-primary/25 uppercase">Sessions</span>
        <span className="font-mono text-[8px] tracking-[0.2em] text-primary/20 uppercase">Sort: Recent</span>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto" data-scroll-preserve>
        {loading ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3">
            <div className="w-6 h-6 border border-primary/20 border-t-primary/60 rounded-full animate-spin" />
            <span className="font-mono text-[9px] tracking-widest text-primary/30 uppercase">Loading sessions...</span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-4 px-8">
            <div className="w-12 h-12 border border-primary/15 flex items-center justify-center">
              <span className="font-mono text-primary/20 text-xl">▢</span>
            </div>
            <p className="font-mono text-[10px] tracking-[0.2em] text-primary/30 uppercase text-center leading-relaxed">
              No sessions found.<br />Start a new session to begin.
            </p>
            <button
              onClick={() => setShowModeSelect(true)}
              className="flex items-center gap-2 px-4 py-2 border border-primary/30 bg-primary/5 hover:bg-primary/10 transition-all font-mono text-[10px] tracking-[0.2em] uppercase text-primary"
            >
              <Plus className="w-3 h-3" />
              New Session
            </button>
          </div>
        ) : (
          <div>
            {sessions.map((session, idx) => {
              const lastMsg = session.messages?.[session.messages.length - 1];
              const preview = lastMsg?.content?.slice(0, 60) || session.last_message || "";
              const charTag = session.character_name || (session.mode === "group" ? "Group" : null);
              return (
                <button
                  key={session.id}
                  onClick={() => navigate(`/chat/${session.id}`)}
                  className="w-full flex flex-col text-left px-4 py-4 border-b border-primary/8 hover:bg-primary/5 transition-all group"
                >
                  <div className="flex items-start justify-between gap-3 mb-1">
                    <span className="font-mono text-[11px] tracking-[0.25em] text-primary uppercase truncate group-hover:text-primary/90">
                      {session.title || `Session ${idx + 1}`}
                    </span>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {charTag && (
                        <span className="font-mono text-[8px] tracking-widest text-primary/30 uppercase border border-primary/15 px-1.5 py-0.5">
                          {charTag}
                        </span>
                      )}
                      <span className="font-mono text-[9px] text-primary/25">
                        {timeAgo(session.updated_date || session.created_date)}
                      </span>
                    </div>
                  </div>
                  {preview && (
                    <p className="font-mono text-[10px] text-primary/35 leading-relaxed truncate">
                      {preview}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
