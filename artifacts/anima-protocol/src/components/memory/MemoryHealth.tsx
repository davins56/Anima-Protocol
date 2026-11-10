/**
 * Compact memory-health pill for the chat header: how many memories she holds,
 * the oldest memory she surfaced recently, and the "Why she said that" ledger.
 */
import { lazy, Suspense, useEffect, useId, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { formatAge, useMemoryHealth } from "@/hooks/useMemoryHealth";

const RecallLedgerPanel = lazy(() => import("./RecallLedgerPanel"));

export default function MemoryHealth({
  characterId,
  characterName,
  refreshKey,
  sessionId,
  returnTo,
}: {
  characterId?: string | null;
  characterName?: string;
  refreshKey?: unknown;
  sessionId?: string | null;
  returnTo?: string | null;
}) {
  const health = useMemoryHealth(characterId, refreshKey);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  if (!characterId) return null;

  const oldest = health?.oldest_recent_recall;
  const lastRecall = health?.last_recall_at ? new Date(health.last_recall_at) : null;
  const tone =
    !health
      ? "text-primary/40 border-primary/15"
      : health.memory_count === 0
        ? "text-primary/30 border-primary/15"
        : oldest
          ? "text-emerald-300 border-emerald-400/30"
          : "text-primary/60 border-primary/25";

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        aria-label={`${characterName || "Companion"} memory health`}
        className={`flex items-center gap-1 px-1.5 py-0.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase ${tone}`}
        title={oldest ? `Recently recalled a memory from ${formatAge(oldest.age_s)} ago` : "Memory core"}
      >
        <Brain className="w-3 h-3" />
        <span>{health ? health.memory_count : "—"}</span>
        {oldest && <span className="hidden sm:inline">· {formatAge(oldest.age_s)}</span>}
      </button>
      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label={`${characterName || "Companion"} memory core and why she said that`}
          className="absolute z-40 mt-1 right-0 w-[min(22rem,calc(100vw-1.5rem))] max-h-[min(32rem,75vh)] overflow-y-auto p-3 bg-black/95 border border-primary/30 font-mono text-[10px] text-primary/70 space-y-3 motion-reduce:transition-none"
        >
          <div className="space-y-1.5">
            <p className="text-primary tracking-widest uppercase text-[9px]">Memory core</p>
            {health ? (
              <>
                <p>
                  {health.memory_count} memories
                  {health.first_memory_at ? ` since ${new Date(health.first_memory_at).toLocaleDateString()}` : ""}
                </p>
                {health.identity_version != null && (
                  <p>Identity v{health.identity_version} (versioned, never overwritten)</p>
                )}
                <p>Last recall: {lastRecall ? lastRecall.toLocaleString() : "not yet"}</p>
                {oldest && (
                  <p className="text-emerald-300/80">
                    Oldest recalled this week ({formatAge(oldest.age_s)} old): “{oldest.content}”
                  </p>
                )}
              </>
            ) : (
              <p className="text-primary/50">Memory totals are not available yet.</p>
            )}
          </div>
          <Suspense
            fallback={
              <p role="status" className="text-primary/50">
                Opening what she recalled…
              </p>
            }
          >
            <RecallLedgerPanel
              characterId={characterId}
              characterName={characterName}
              sessionId={sessionId}
              returnTo={returnTo}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
