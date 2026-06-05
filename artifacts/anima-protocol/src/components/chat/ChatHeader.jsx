import { useState } from "react";
import { ChevronLeft, Zap, BookText, Check, Loader, BookOpen, Sparkles } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import MoodIndicator from "@/components/chat/MoodIndicator";

export default function ChatHeader({ session, characters, mood, characterEmotions, onToggleDeepMode }) {
  const navigate = useNavigate();
  const [summarizing, setSummarizing] = useState(false);
  const [summarized, setSummarized] = useState(false);

  const isGroup = session?.mode === "group";
  const charIds = isGroup ? (session.group_character_ids || []) : (session?.character_id ? [session.character_id] : []);
  const activeChars = characters.filter((c) => charIds.includes(c.id));
  const primaryChar = activeChars[0];
  const primaryEmotion = primaryChar?.id ? characterEmotions?.[primaryChar.id] : null;

  const handleSummarize = async () => {
    if (!session?.id || summarizing) return;
    setSummarizing(true);
    await base44.functions.invoke("generateStorySummary", { session_id: session.id }).catch(() => {});
    setSummarizing(false);
    setSummarized(true);
    setTimeout(() => setSummarized(false), 3000);
  };

  const getEmotionColor = (emotion) => {
    const colors = {
      joyful: "text-green-400",
      calm: "text-blue-400",
      sad: "text-cyan-300",
      angry: "text-red-400",
      afraid: "text-orange-300",
      disgusted: "text-purple-400",
      surprised: "text-yellow-400",
      hopeful: "text-lime-400",
      conflicted: "text-pink-400",
      desperate: "text-red-300",
    };
    return colors[emotion] || "text-primary/60";
  };

  return (
    <div className="flex items-center gap-2 sm:gap-4 px-3 sm:px-4 py-2 sm:py-3 bg-transparent">
      <button
        onClick={() => navigate("/")}
        className="lg:hidden text-primary/40 hover:text-primary transition-colors p-1"
      >
        <ChevronLeft className="w-4 sm:w-5 h-4 sm:h-5" />
      </button>

      {/* Character Avatar(s) */}
      {isGroup ? (
        <div className="flex -space-x-1.5 sm:-space-x-2">
          {activeChars.slice(0, 4).map((char, i) => (
            <div key={char.id} className="w-6 sm:w-8 h-6 sm:h-8 border border-primary/40 bg-primary/10 overflow-hidden flex-shrink-0" style={{ zIndex: 4 - i }}>
              {char.avatar_url ? (
                <img src={char.avatar_url} alt={char.name} className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center font-mono text-primary text-[10px] sm:text-xs">
                  {char.name[0]}
                </div>
              )}
            </div>
          ))}
          {activeChars.length > 4 && (
            <div className="w-6 sm:w-8 h-6 sm:h-8 border border-primary/40 bg-primary/10 flex items-center justify-center">
              <span className="font-mono text-primary text-[8px] sm:text-[9px]">+{activeChars.length - 4}</span>
            </div>
          )}
        </div>
      ) : primaryChar ? (
        <div className="w-6 sm:w-8 h-6 sm:h-8 border border-primary/40 overflow-hidden flex-shrink-0">
          {primaryChar.avatar_url ? (
            <img src={primaryChar.avatar_url} alt={primaryChar.name} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full bg-primary/10 flex items-center justify-center font-mono text-primary text-sm">
              {primaryChar.name[0]}
            </div>
          )}
        </div>
      ) : null}

      {/* Title */}
      <div className="flex-1 min-w-0">
        <h2 className="font-mono text-[9px] sm:text-xs text-primary tracking-[0.2em] uppercase truncate">
          {session?.title || (isGroup ? "Group" : primaryChar?.name || "Session")}
        </h2>
        <div className="flex items-center gap-1.5 sm:gap-3 mt-0.5 flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-1 sm:w-1.5 h-1 sm:h-1.5 bg-primary rounded-full animate-pulse" />
            <span className="text-[8px] sm:text-[9px] font-mono text-primary/40 tracking-widest uppercase">
              {isGroup ? `${activeChars.length} active` : "Online"}
            </span>
          </div>
          {!isGroup && primaryEmotion && (
            <div className="hidden md:flex items-center gap-1 text-[8px] sm:text-[9px] font-mono">
              <span className="text-primary/50 tracking-widest">Feeling:</span>
              <span className={`tracking-widest uppercase ${getEmotionColor(primaryEmotion.emotion)}`}>
                {primaryEmotion.emotion}
              </span>
              <div className="w-6 h-0.5 border border-primary/20 bg-primary/10">
                <div 
                  className="h-full bg-primary/60 transition-all"
                  style={{ width: `${primaryEmotion.intensity}%` }}
                />
              </div>
            </div>
          )}
          {!isGroup && mood && <MoodIndicator mood={mood} />}
        </div>
      </div>

      {/* Deep mode toggle — forces every reply onto the most capable model */}
      {onToggleDeepMode && (
        <button
          onClick={onToggleDeepMode}
          title={
            session?.deep_mode
              ? "Deep mode ON — replies use the most capable model"
              : "Deep mode OFF — replies use cost-saving auto routing"
          }
          aria-pressed={!!session?.deep_mode}
          className={`flex items-center gap-1 px-2 py-1 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all ${
            session?.deep_mode
              ? "border-primary/60 text-primary bg-primary/10"
              : "border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40"
          }`}
        >
          <Sparkles className="w-2.5 h-2.5" />
          <span className="hidden sm:inline">Deep</span>
        </button>
      )}

      {/* Story Reader button */}
      <button
        onClick={() => navigate(`/story-reader/${session?.id}`)}
        title="Read as formatted story"
        className="hidden md:flex items-center gap-1 px-2 py-1 border border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40 font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all"
      >
        <BookOpen className="w-2.5 h-2.5" />
        <span className="hidden sm:inline">Read</span>
      </button>

      {/* Summarize button */}
      <button
        onClick={handleSummarize}
        disabled={summarizing}
        title="Generate story summary lore entry"
        className={`hidden md:flex items-center gap-1 px-2 py-1 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase transition-all ${
          summarized
            ? "border-green-400/50 text-green-400 bg-green-400/10"
            : "border-primary/20 text-primary/30 hover:text-primary/70 hover:border-primary/40"
        }`}
      >
        {summarizing ? (
          <Loader className="w-2.5 h-2.5 animate-spin" />
        ) : summarized ? (
          <Check className="w-2.5 h-2.5" />
        ) : (
          <BookText className="w-2.5 h-2.5" />
        )}
        <span className="hidden sm:inline">{summarized ? "Saved" : "Summarize"}</span>
      </button>

      {/* Status */}
      <div className="hidden md:flex items-center gap-1.5 text-primary/30">
        <Zap className="w-2.5 h-2.5" />
        <span className="font-mono text-[8px] tracking-[0.2em] uppercase">Online</span>
      </div>
    </div>
  );
}