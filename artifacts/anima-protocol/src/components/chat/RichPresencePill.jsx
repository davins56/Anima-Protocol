/**
 * Chat upgrade 6b (VITE_ANIMA_RICH_PRESENCE): replaces the static "Online"
 * pill with what she is doing now, or why she can't answer.
 */
const TONE = {
  ok: { dot: "bg-primary", pulse: true, text: "text-primary/40" },
  busy: { dot: "bg-cyan-300", pulse: true, text: "text-cyan-200/70" },
  warn: { dot: "bg-amber-400", pulse: false, text: "text-amber-200/80" },
  off: { dot: "bg-zinc-500", pulse: false, text: "text-zinc-400" },
};

export default function RichPresencePill({ presence }) {
  if (!presence) return null;
  const tone = TONE[presence.tone] || TONE.ok;
  return (
    <div
      className="flex items-center gap-1 min-w-0"
      data-testid="rich-presence"
      data-presence-kind={presence.kind}
      title={presence.detail || presence.label}
      role="status"
      aria-live="polite"
    >
      <div
        className={`w-1 sm:w-1.5 h-1 sm:h-1.5 rounded-full flex-shrink-0 ${tone.dot} ${tone.pulse ? "animate-pulse motion-reduce:animate-none" : ""}`}
        aria-hidden="true"
      />
      <span className={`text-[8px] sm:text-[9px] font-mono tracking-widest uppercase truncate ${tone.text}`}>
        {presence.label}
      </span>
    </div>
  );
}
