// @ts-check
import { Heart, Sparkles, History, Scale } from "lucide-react";

// Directorial chips that nudge the scene's emotional register. Every directive
// stays within emotional / psychological / spiritual intimacy — never explicit.
const CHIPS = [
  {
    label: "Deepen the scene",
    icon: Sparkles,
    directive:
      "Slow down and deepen this moment between us — more presence, more breath, more unspoken feeling. Stay with the emotional charge.",
  },
  {
    label: "Recall that moment",
    icon: History,
    directive:
      "Bring up something meaningful we've shared before — let a real memory between us surface and color how you respond.",
  },
  {
    label: "Shift the dynamic",
    icon: Scale,
    directive:
      "Shift the emotional power between us right now — change who leads and who yields, and let the tension move.",
  },
  {
    label: "Aftercare",
    icon: Heart,
    directive:
      "Hold space for me now — soft, reassuring, grounding. Tend to how I'm feeling with warmth and care.",
  },
];

/** @param {{ onSelect: (...args: any[]) => void, disabled?: boolean }} props */
export default function QuickActionChips({ onSelect, disabled = false }) {
  return (
    <div
      className="flex gap-1.5 overflow-x-auto px-2 pb-1"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {CHIPS.map(({ label, icon: Icon, directive }) => (
        <button
          key={label}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(directive)}
          className="flex items-center gap-1.5 flex-shrink-0 font-mono text-[9px] tracking-[0.15em] uppercase text-primary/55 hover:text-primary border border-primary/20 hover:border-primary/50 bg-black/30 hover:bg-primary/5 rounded-full px-2.5 py-1 transition-all disabled:opacity-30 disabled:pointer-events-none"
        >
          <Icon className="w-2.5 h-2.5" />
          {label}
        </button>
      ))}
    </div>
  );
}