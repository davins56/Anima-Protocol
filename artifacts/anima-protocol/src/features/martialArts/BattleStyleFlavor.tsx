import { pickLabel, SEED_LIBRARY } from "@workspace/martial-core";
import { latestNarration, type BattleStyle } from "./battleStyle";

/** HUD badge plus the latest technique line. Plain text; renders nothing without a style. */
export default function BattleStyleFlavor({
  style,
  events,
  className = "",
}: {
  style: BattleStyle | null;
  events: ReadonlyArray<{ type: string; seq?: number; unitId?: string; sourceId?: string; outcome?: string }>;
  className?: string;
}) {
  if (!style) return null;
  const line = latestNarration(events, style);
  return (
    <div className={`font-mono text-[10px] tracking-wider ${className}`} data-testid="battle-style-flavor">
      <span className="border border-cyan-300/40 px-1.5 py-0.5 uppercase text-cyan-200/80">{pickLabel(SEED_LIBRARY, style.pick)}</span>
      {line && <span className="ml-2 text-cyan-100/70">{line}</span>}
    </div>
  );
}
