/**
 * Compact memory-health pill for the chat header: how many memories she holds
 * and the oldest memory she surfaced recently ("recalled 7mo-old memory").
 *
 * The details panel is portaled to document.body. An in-flow `absolute z-40`
 * dropdown is clipped by the header's overflow-x-auto scroller and trapped
 * under later rows (Chats/Stage/Online, Resonance/Synchro) because those
 * rows — and the glass header itself — create their own stacking contexts
 * via backdrop-filter.
 */
import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";
import PortaledFixedPanel from "@/components/chat/PortaledFixedPanel";
import { formatAge, useMemoryHealth } from "@/hooks/useMemoryHealth";

export default function MemoryHealth({
  characterId,
  characterName,
  refreshKey,
}: {
  characterId?: string | null;
  characterName?: string;
  refreshKey?: unknown;
}) {
  const health = useMemoryHealth(characterId, refreshKey);
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setOpen(false);
  }, [characterId]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  if (!health) return null;

  const oldest = health.oldest_recent_recall;
  const lastRecall = health.last_recall_at ? new Date(health.last_recall_at) : null;
  const tone = health.memory_count === 0 ? "text-primary/30 border-primary/15" : oldest ? "text-emerald-300 border-emerald-400/30" : "text-primary/60 border-primary/25";

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${characterName || "Companion"} memory health`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? "memory-health-panel" : undefined}
        className={`flex items-center gap-1 px-1.5 py-0.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase ${tone}`}
        title={oldest ? `Recently recalled a memory from ${formatAge(oldest.age_s)} ago` : "Memory core"}
      >
        <Brain className="w-3 h-3" />
        <span>{health.memory_count}</span>
        {oldest && <span className="hidden sm:inline">· {formatAge(oldest.age_s)}</span>}
      </button>
      <PortaledFixedPanel
        open={open}
        onDismiss={close}
        anchorRef={buttonRef}
        align="left"
        className="w-64 max-w-[calc(100vw-16px)] p-3 bg-black/90 border border-primary/30 font-mono text-[10px] text-primary/70 overflow-y-auto"
        panelTestId="memory-health-panel"
        backdropTestId="memory-health-backdrop"
      >
        <div id="memory-health-panel" role="dialog" aria-label="Memory core" className="space-y-1.5">
          <p className="text-primary tracking-widest uppercase text-[9px]">Memory core</p>
          <p>{health.memory_count} memories{health.first_memory_at ? ` since ${new Date(health.first_memory_at).toLocaleDateString()}` : ""}</p>
          {health.identity_version != null && <p>Identity v{health.identity_version} (versioned, never overwritten)</p>}
          <p>Last recall: {lastRecall ? lastRecall.toLocaleString() : "not yet"}</p>
          {oldest && (
            <p className="text-emerald-300/80">
              Oldest recalled this week ({formatAge(oldest.age_s)} old): “{oldest.content}”
            </p>
          )}
        </div>
      </PortaledFixedPanel>
    </div>
  );
}
