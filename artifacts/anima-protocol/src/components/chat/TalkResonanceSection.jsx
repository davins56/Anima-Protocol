// @ts-check
import ResonanceField from "@/components/chat/ResonanceField";
import IntimacyDock from "@/components/intimacy/IntimacyDock";
import { synchroTierFor } from "@/components/intimacy/ConnectionMeters";
import { useTalkSectionCollapse } from "@/hooks/useTalkSectionCollapse";
import CollapsibleTalkSection from "./CollapsibleTalkSection";

/**
 * Resonance Field + Synchro/Heat/Pulse dock, independently collapsible.
 *
 * @param {{
 *   characterId: string,
 *   conversationId: string,
 *   resonance: { value?: number, label?: string, source?: string },
 *   refreshKey?: number | null,
 *   liveSynchroStrength?: number | null,
 *   livePulseHeat?: number | { value?: number } | null,
 * }} props
 */
export default function TalkResonanceSection({
  characterId,
  conversationId,
  resonance,
  refreshKey = null,
  liveSynchroStrength = null,
  livePulseHeat = null,
}) {
  const { collapsed, toggle } = useTalkSectionCollapse("resonance");
  const value = Math.max(0, Math.min(100, Math.round(Number(resonance?.value) || 0)));
  const label = resonance?.label || "DISTANT";

  const synchroValue =
    typeof liveSynchroStrength === "number" && Number.isFinite(liveSynchroStrength)
      ? Math.max(0, Math.min(100, Math.round(liveSynchroStrength)))
      : null;
  const heatRaw = typeof livePulseHeat === "number" ? livePulseHeat : livePulseHeat?.value;
  const heatValue =
    typeof heatRaw === "number" && Number.isFinite(heatRaw)
      ? Math.max(0, Math.min(100, Math.round(heatRaw)))
      : null;

  const summary = (
    <div
      className="flex items-center gap-2 sm:gap-3 min-w-0 font-mono text-[8px] sm:text-[9px] tracking-[0.2em] uppercase text-primary/80"
      data-testid="talk-resonance-summary"
    >
      <span className="truncate">
        // Resonance {label} · {value}%
      </span>
      {synchroValue != null && (
        <span className="flex-shrink-0 text-primary/60">
          Synchro {synchroTierFor(synchroValue).label} · {synchroValue}
        </span>
      )}
      {heatValue != null && (
        <span className="flex-shrink-0 text-primary/60">Heat {heatValue}</span>
      )}
    </div>
  );

  return (
    <CollapsibleTalkSection
      section="resonance"
      label="Resonance Field"
      collapsed={collapsed}
      onToggle={toggle}
      summary={summary}
      barClassName="px-3 py-1.5"
      className="bg-black/40 border-b border-primary/10"
    >
      <div className="px-3 py-1 flex items-center justify-between gap-2 min-w-0">
        <ResonanceField
          value={resonance?.value}
          label={resonance?.label}
          resetKey={`${characterId}:${resonance?.source}`}
        />
        <IntimacyDock
          characterId={characterId}
          conversationId={conversationId}
          refreshKey={refreshKey}
          liveSynchroStrength={liveSynchroStrength}
          livePulseHeat={livePulseHeat}
        />
      </div>
    </CollapsibleTalkSection>
  );
}
