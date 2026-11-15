import { useState } from "react";
import { explainCompanionAffect } from "@/lib/companionAffect";
import { cueExplanation } from "@/lib/emotionCues";
import { useEmotionCues } from "@/components/chat/EmotionCuesContext";

/**
 * Mood chip that opens a "why she feels this" panel from the server affect snapshot.
 * With ANIMA_EMOTIONS on (#765) it becomes an optional prose panel from the
 * fixed phrase table: no labels, numbers, focus, intent or times (Q4).
 */
export default function MoodWhyPanel({ affect, fallbackMood, name, characterId = null }) {
  const emotionCues = useEmotionCues();
  if (emotionCues.enabled === true) {
    return <MoodProsePanel cue={emotionCues.cueFor(characterId)} name={name} />;
  }
  return <MoodLabelPanel affect={affect} fallbackMood={fallbackMood} name={name} />;
}

function MoodProsePanel({ cue, name }) {
  const [open, setOpen] = useState(false);
  const lines = cueExplanation(cue, name);
  if (!lines.length) return null;
  const who = String(name || "").trim() || "she";
  return (
    <span className="relative inline-flex flex-col items-end">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="mood-why-panel"
        aria-label={lines[0]}
        onClick={() => setOpen((v) => !v)}
        className="font-mono text-[11px] text-primary/60 hover:text-primary underline decoration-dotted underline-offset-2 min-h-[32px] touch-manipulation"
        data-testid="mood-chip"
      >
        How {who} seems
      </button>
      {open && (
        <div
          id="mood-why-panel"
          role="region"
          aria-label={`How ${who} seems`}
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

function MoodLabelPanel({ affect, fallbackMood, name }) {
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
