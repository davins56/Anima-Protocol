import { useState } from "react";
import { explainCompanionAffect } from "@/lib/companionAffect";

/** Mood chip that opens a "why she feels this" panel from the server affect snapshot. */
export default function MoodWhyPanel({ affect, fallbackMood, name }) {
  const [open, setOpen] = useState(false);
  const lines = explainCompanionAffect(affect, name);
  const label = affect?.mood || fallbackMood || "—";
  if (!lines.length) {
    return <span className="font-mono text-[11px] text-primary/50">Mood: {label}</span>;
  }
  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mood-why-panel"
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] text-primary/60 hover:text-primary underline decoration-dotted underline-offset-2 min-h-[32px] touch-manipulation"
        data-testid="mood-chip"
      >
        Mood: {label} · why?
      </button>
      {open && (
        <div
          id="mood-why-panel"
          role="region"
          aria-label="Why she feels this"
          data-testid="mood-why-panel"
          className="mt-1 w-64 max-w-[80vw] rounded border border-primary/25 bg-black/85 p-3 text-left text-[12px] leading-relaxed text-cyan-50/90 space-y-1"
        >
          {lines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      )}
    </span>
  );
}
