/**
 * Compact memory-health pill for the chat header: how many memories she holds
 * and the oldest memory she surfaced recently ("recalled 7mo-old memory").
 */
import { useState } from "react";
import { Brain } from "lucide-react";
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
  if (!health) return null;

  const oldest = health.oldest_recent_recall;
  const lastRecall = health.last_recall_at ? new Date(health.last_recall_at) : null;
  const tone = health.memory_count === 0 ? "text-primary/30 border-primary/15" : oldest ? "text-emerald-300 border-emerald-400/30" : "text-primary/60 border-primary/25";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`${characterName || "Companion"} memory health`}
        className={`flex items-center gap-1 px-1.5 py-0.5 border font-mono text-[8px] sm:text-[9px] tracking-widest uppercase ${tone}`}
        title={oldest ? `Recently recalled a memory from ${formatAge(oldest.age_s)} ago` : "Memory core"}
      >
        <Brain className="w-3 h-3" />
        <span>{health.memory_count}</span>
        {oldest && <span className="hidden sm:inline">· {formatAge(oldest.age_s)}</span>}
      </button>
      {open && (
        <div className="absolute z-40 mt-1 right-0 w-64 p-3 bg-black/90 border border-primary/30 font-mono text-[10px] text-primary/70 space-y-1.5">
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
      )}
    </div>
  );
}
