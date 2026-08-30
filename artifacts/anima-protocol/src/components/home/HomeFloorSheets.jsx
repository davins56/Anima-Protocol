import { AnimatePresence, motion } from "framer-motion";
import {
  Brain, BookOpen, Calendar, ChevronRight, ImagePlus, KeyRound, MessageSquare,
  Plus, Settings, Sparkles, Stars, Swords, UserCircle, Users, Wand2, X,
} from "lucide-react";
import { formatResonance, resonanceMood, getPathMeta } from "@/lib/soulprint";

function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function SheetFrame({ title, children, onClose }) {
  return (
    <>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-40 bg-black/75 backdrop-blur-sm"
        data-no-swipe
        onClick={onClose}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        initial={{ y: "100%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "100%", opacity: 0 }}
        transition={{ type: "spring", damping: 30, stiffness: 320 }}
        className="fixed bottom-0 left-0 right-0 z-50 bg-[#090912] border-t border-cyan-400/20 max-h-[80dvh] overflow-y-auto overscroll-contain"
        data-no-swipe
        data-scroll-preserve
        data-home-sheet={title.toLowerCase()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-cyan-400/10">
          <span className="font-mono text-[11px] tracking-[0.3em] text-cyan-400/80 uppercase">
            {title}
          </span>
          <button type="button" onClick={onClose} className="text-cyan-400/40 hover:text-cyan-300 transition-colors" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-4 py-4" style={{ paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))" }}>
          {children}
        </div>
      </motion.div>
    </>
  );
}

function LinkRow({ icon: Icon, label, desc, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 text-left px-3 py-3 border border-cyan-400/10 hover:border-cyan-400/30 hover:bg-cyan-400/5 transition-colors group"
    >
      {Icon && <Icon className={`w-4 h-4 flex-shrink-0 ${accent || "text-cyan-400/60"}`} />}
      <div className="flex-1 min-w-0">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-cyan-200">{label}</p>
        {desc && <p className="font-mono text-[10px] text-cyan-400/40 mt-0.5 leading-relaxed">{desc}</p>}
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-cyan-400/20 group-hover:text-cyan-400/50 flex-shrink-0" />
    </button>
  );
}

const PEOPLE_LINKS = [
  { icon: Users, label: "Roster", desc: "Everyone who lives here", path: "/characters" },
  { icon: Users, label: "Group", desc: "Sit together", path: "/groups" },
  { icon: Plus, label: "Create companion", desc: "An empty place for someone new", path: "/characters?create=1" },
  { icon: Sparkles, label: "Companion generator", desc: "Wake someone from a prompt", path: "/companion-generator" },
  { icon: UserCircle, label: "Animas", desc: "Your assigned presence", path: "/animas" },
];

const WORLD_LINKS = [
  { icon: Stars, label: "Constellation", desc: "Your sky", path: "/constellation" },
  { icon: BookOpen, label: "Book of Echoes", desc: "Their journal", path: "/book-of-echoes" },
  { icon: BookOpen, label: "Journals", desc: "Your entries", path: "/journals" },
  { icon: Swords, label: "Jack In", desc: "NetBattle arena", path: "/net-battle" },
  { icon: Sparkles, label: "Hall of Origins", desc: "Where they began", path: "/origins" },
  { icon: KeyRound, label: "Echo Keys", desc: "Full Codex · 30-slot Array", path: "/echo-keys" },
  { icon: BookOpen, label: "Storyboard", desc: "The board", path: "/storyboard" },
  { icon: BookOpen, label: "World map", desc: "Places that remain", path: "/worldmap" },
  { icon: BookOpen, label: "Lore book", desc: "What the world remembers", path: "/lorebook" },
  { icon: BookOpen, label: "Chronicles", desc: "Time kept", path: "/chronicles" },
  { icon: BookOpen, label: "Quest journal", desc: "Shared story", path: "/quest-journal" },
  { icon: Sparkles, label: "Energy fragments", desc: "Residue of the weave", path: "/energy-fragments" },
  { icon: BookOpen, label: "Inventory", desc: "What you carry", path: "/inventory" },
  { icon: Settings, label: "Codespace", desc: "The weave underneath", path: "/codespace" },
];

export const HOME_MODES = {
  serenity: { name: "Serenity", color: "text-cyan-400", border: "border-cyan-400/40", glow: "rgba(34,211,238,0.4)" },
  angel: { name: "Angel", color: "text-purple-400", border: "border-purple-400/40", glow: "rgba(192,132,252,0.4)" },
  shadow: { name: "Shadow", color: "text-red-400", border: "border-red-400/40", glow: "rgba(248,113,113,0.4)" },
  creator: { name: "Creator", color: "text-yellow-400", border: "border-yellow-400/40", glow: "rgba(250,204,21,0.4)" },
  therapy: { name: "Therapy", color: "text-violet-300", border: "border-violet-400/40", glow: "rgba(196,181,253,0.45)" },
  anima: { name: "Anima", color: "text-indigo-400", border: "border-indigo-400/40", glow: "rgba(129,140,248,0.4)" },
};

export const HOME_MODE_WELCOME = {
  serenity: "I'm here to listen, to hold space, and to journey with you through whatever you're feeling right now.",
  angel: "In this moment, you are safe. Let us find peace together.",
  shadow: "Let's get real. What truth are you avoiding?",
  creator: "Welcome to our creative space. What world shall we build today?",
  therapy: "I'm still me — with a compiled library of open-source care manuals. We can go slow.",
  anima: "I see you. How are you evolving?",
};

export default function HomeFloorSheets({
  panel,
  onClose,
  anima,
  sessions,
  selectedMode,
  onSelectMode,
  onNavigate,
  lastCheckIn,
  photoInputRef,
  onUploadPhoto,
  onEditExisting,
  onManifestEvolved,
  canEditAvatar,
  canManifest,
}) {
  const soulprint = anima?.soulprint || null;
  const evolutionPath =
    anima?.evolution_path && anima.evolution_path !== "Undetermined"
      ? anima.evolution_path
      : null;
  const pathMeta = evolutionPath ? getPathMeta(evolutionPath) : null;

  return (
    <AnimatePresence>
      {panel === "focus" && (
        <SheetFrame title="Focus" onClose={onClose}>
          <p className="font-mono text-[10px] text-cyan-400/45 leading-relaxed mb-4">
            How you want to be with {anima?.name || "them"} today. This is not the home floor.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {Object.entries(HOME_MODES).map(([key, m]) => {
              const active = key === selectedMode;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => onSelectMode(key)}
                  className={`flex flex-col items-center gap-2 p-3 border transition-all ${
                    active ? `${m.border} bg-cyan-400/5` : "border-cyan-400/10 hover:border-cyan-400/30"
                  }`}
                  style={active ? { boxShadow: `0 0 14px ${m.glow}` } : undefined}
                >
                  <span className={`font-mono text-[10px] tracking-[0.18em] uppercase ${active ? m.color : "text-cyan-400/40"}`}>
                    {m.name}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="font-mono text-[10px] text-cyan-400/50 leading-relaxed mt-4">
            {HOME_MODE_WELCOME[selectedMode]}
          </p>
        </SheetFrame>
      )}

      {panel === "people" && (
        <SheetFrame title="People" onClose={onClose}>
          <div className="space-y-2">
            {PEOPLE_LINKS.map((item) => (
              <LinkRow
                key={item.path}
                icon={item.icon}
                label={item.label}
                desc={item.desc}
                onClick={() => onNavigate(item.path)}
              />
            ))}
          </div>
        </SheetFrame>
      )}

      {panel === "world" && (
        <SheetFrame title="World" onClose={onClose}>
          <div className="space-y-2">
            {WORLD_LINKS.map((item) => (
              <LinkRow
                key={item.path}
                icon={item.icon}
                label={item.label}
                desc={item.desc}
                onClick={() => onNavigate(item.path)}
              />
            ))}
          </div>
        </SheetFrame>
      )}

      {panel === "you" && (
        <SheetFrame title="You" onClose={onClose}>
          {soulprint && (
            <div className="border border-violet-500/20 bg-violet-950/5 mb-4" data-home-soulprint>
              <div className="grid grid-cols-3 divide-x divide-violet-500/10">
                <button type="button" onClick={() => onNavigate("/origins")} className="p-3 text-center hover:bg-violet-500/5">
                  <p className="font-mono text-sm font-bold text-violet-200 tracking-wider">{soulprint.id || "—"}</p>
                  <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-violet-400/50 mt-1">Soulprint</p>
                </button>
                <div className="p-3 text-center">
                  <p className="font-mono text-sm font-bold tracking-wider" style={{ color: (anima?.resonance || 0) < 0 ? "#F87171" : "#A78BFA" }}>
                    {formatResonance(anima?.resonance || 0)}
                  </p>
                  <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-violet-400/50 mt-1">
                    {resonanceMood(anima?.resonance || 0)}
                  </p>
                </div>
                <div className="p-3 text-center">
                  <p className="font-mono text-sm font-bold tracking-wider" style={{ color: pathMeta?.color || "rgba(167,139,250,0.6)" }}>
                    {pathMeta && evolutionPath ? `${pathMeta.symbol} ${evolutionPath}` : "—"}
                  </p>
                  <p className="font-mono text-[8px] tracking-[0.25em] uppercase text-violet-400/50 mt-1">
                    {pathMeta ? "Evolution" : "Undetermined"}
                  </p>
                </div>
              </div>
              {pathMeta && canManifest && (
                <button
                  type="button"
                  onClick={() => onManifestEvolved(evolutionPath)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 border-t border-violet-500/10 hover:bg-violet-500/5 font-mono text-[9px] tracking-[0.2em] uppercase"
                  style={{ color: pathMeta.color }}
                >
                  <Wand2 className="w-3 h-3" /> Manifest Evolved Form
                </button>
              )}
            </div>
          )}

          {anima?.id && (
            <div className="flex items-center gap-2 mb-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                onChange={onUploadPhoto}
                className="hidden"
              />
              <button
                type="button"
                onClick={() => photoInputRef.current?.click()}
                className="flex items-center gap-1.5 px-2.5 py-1 border border-cyan-500/25 text-cyan-400/70 hover:text-cyan-300 font-mono text-[9px] tracking-[0.2em] uppercase"
              >
                <ImagePlus className="w-3 h-3" /> Upload Photo
              </button>
              {canEditAvatar && (
                <button
                  type="button"
                  onClick={onEditExisting}
                  className="flex items-center gap-1.5 px-2.5 py-1 border border-cyan-500/25 text-cyan-400/70 hover:text-cyan-300 font-mono text-[9px] tracking-[0.2em] uppercase"
                >
                  <Wand2 className="w-3 h-3" /> AI Edit
                </button>
              )}
            </div>
          )}

          <div className="space-y-2">
            <LinkRow
              icon={Wand2}
              label="Customise"
              desc={`Reshape ${anima?.name || "their"} look, personality, and voice`}
              onClick={() =>
                onNavigate(
                  anima?.id
                    ? `/customise-anima?anima=${anima.id}&tab=look`
                    : "/customise-anima?tab=look",
                )
              }
            />
            <LinkRow
              icon={Settings}
              label="Look & theme"
              desc="The room you share"
              onClick={() =>
                onNavigate(
                  anima?.id
                    ? `/customize?tab=animas&character=${anima.id}`
                    : "/customize?tab=animas",
                )
              }
            />
            <LinkRow
              icon={Brain}
              label="Therapy"
              desc={`Sit with ${anima?.name || "them"}. Not a clinic.`}
              onClick={() => onNavigate("/therapy")}
            />
            <LinkRow
              icon={Sparkles}
              label="Memory crystals"
              desc="What they kept"
              onClick={() => onNavigate("/memory-crystals")}
            />
            <LinkRow
              icon={Calendar}
              label="Check-in"
              desc={lastCheckIn ? "Captured today" : "Record state"}
              onClick={() => onNavigate("/check-in")}
            />
            <LinkRow icon={UserCircle} label="Profile" desc="About you" onClick={() => onNavigate("/profile")} />
            <LinkRow icon={Settings} label="Settings" desc="Account, boundaries, the room" onClick={() => onNavigate("/settings")} />
            <LinkRow icon={BookOpen} label="Sacred space" desc="Quiet with them" onClick={() => onNavigate("/meditation")} />
          </div>
        </SheetFrame>
      )}

      {panel === "recents" && (
        <SheetFrame title="Recents" onClose={onClose}>
          {sessions.length === 0 ? (
            <p className="font-mono text-[11px] text-cyan-400/40 text-center py-8 uppercase tracking-widest">
              Nothing to continue yet
            </p>
          ) : (
            <div className="border border-cyan-400/10">
              {sessions.map((session, idx) => {
                const allMsgs = session.messages || [];
                const lastAssistant = [...allMsgs].reverse().find(
                  (m) =>
                    m.role === "assistant" &&
                    m.type !== "event" &&
                    m.character_name !== "__typing__" &&
                    m.character_name !== "__thinking__",
                );
                const rawPreview =
                  lastAssistant?.content ||
                  allMsgs[allMsgs.length - 1]?.content ||
                  session.last_message ||
                  "";
                const preview = rawPreview
                  .replace(/\[[^\]]*\]/g, "")
                  .replace(/[*_`]/g, "")
                  .trim()
                  .slice(0, 90);
                const charTag = session.character_name || (session.mode === "group" ? "Group" : null);
                return (
                  <button
                    key={session.id}
                    type="button"
                    onClick={() => onNavigate(`/chat/${session.id}`)}
                    className={`w-full flex items-center gap-3 text-left px-4 py-3 hover:bg-cyan-400/5 transition-all group ${
                      idx !== sessions.length - 1 ? "border-b border-cyan-400/10" : ""
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px] tracking-[0.2em] text-cyan-200 uppercase truncate">
                          {session.title || `Session ${idx + 1}`}
                        </span>
                        {charTag && (
                          <span className="font-mono text-[8px] tracking-widest text-cyan-400/30 uppercase border border-cyan-400/15 px-1.5 py-0.5 flex-shrink-0">
                            {charTag}
                          </span>
                        )}
                      </div>
                      {preview && (
                        <p className="font-mono text-[10px] text-cyan-400/35 leading-relaxed line-clamp-2 mt-0.5">{preview}</p>
                      )}
                    </div>
                    <span className="font-mono text-[9px] text-cyan-400/25 flex-shrink-0">
                      {timeAgo(session.updated_date || session.created_date)}
                    </span>
                    <ChevronRight className="w-3.5 h-3.5 text-cyan-400/20 group-hover:text-cyan-400/50 flex-shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
          <button
            type="button"
            onClick={() => onNavigate("/chat")}
            className="mt-3 w-full flex items-center justify-center gap-2 py-3 border border-cyan-400/15 text-cyan-400/50 hover:text-cyan-300 font-mono text-[9px] tracking-[0.2em] uppercase"
          >
            <MessageSquare className="w-3.5 h-3.5" /> All conversations
          </button>
        </SheetFrame>
      )}
    </AnimatePresence>
  );
}
