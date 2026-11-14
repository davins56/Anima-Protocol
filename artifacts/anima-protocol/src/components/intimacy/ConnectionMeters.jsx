import { useEffect, useState } from "react";
import { Flame, Link2 } from "lucide-react";
import { formatMeterDelta, useMeterDelta } from "@/hooks/useMeterDelta";

// Mirrors SYNCHRO_THRESHOLDS in api-server synchroEngine.ts.
export const SYNCHRO_TIERS = [
  { min: 0, label: "Disconnected" },
  { min: 16, label: "Linked" },
  { min: 36, label: "Synchronized" },
  { min: 61, label: "Soul Unison" },
  { min: 86, label: "Full Cross" },
];

export function synchroTierFor(value) {
  const v = clamp(value);
  return [...SYNCHRO_TIERS].reverse().find((t) => v >= t.min) || SYNCHRO_TIERS[0];
}

function clamp(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

const MOBILE_QUERY = "(max-width: 639px)";

export function useIsMobileLayout() {
  const read = () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(MOBILE_QUERY).matches
      : false;
  const [mobile, setMobile] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setMobile(query.matches);
    onChange();
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return mobile;
}

function Meter({ id, icon, name, caption, valueLabel, value, ticks, barClass, mobile, delta = null }) {
  const v = clamp(value);
  return (
    <div className={mobile ? "w-full" : "min-w-[9rem]"} data-meter={id}>
      <div className="flex items-center justify-between gap-2 font-mono">
        <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-primary/60">
          {icon}
          {name}
        </span>
        <span className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-primary/90">
          {delta != null && (
            <span
              data-testid={`${id}-delta`}
              aria-live="polite"
              className={`animate-pulse ${delta > 0 ? "text-cyan-300" : "text-rose-300"}`}
            >
              {formatMeterDelta(delta)}
            </span>
          )}
          {valueLabel} · {v}
        </span>
      </div>
      <div
        role="meter"
        aria-label={`${name} — ${caption}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={v}
        aria-valuetext={`${valueLabel}, ${v} of 100`}
        className="relative mt-0.5 h-2 overflow-hidden rounded-full border border-primary/20 bg-black/80"
      >
        <div
          className={`h-full transition-[width,background-color] duration-700 ease-out motion-reduce:transition-none ${barClass}`}
          style={{ width: `${v}%` }}
        />
        {ticks.map((t) => (
          <span
            key={t}
            className="absolute bottom-0 top-0 w-px bg-black/60"
            style={{ left: `${t}%` }}
          />
        ))}
      </div>
      {!mobile && <p className="mt-0.5 text-[8px] leading-tight text-primary/40">{caption}</p>}
    </div>
  );
}

/**
 * Two deliberately separate meters:
 *  - Synchro: long-term resonance earned over time (chat, Sacred Space). Tiered.
 *  - Heat: right-now intensity (heated, emotional or intimate moments); rises
 *    within a scene and cools over a pause.
 * Mobile stacks them full width with short captions; desktop sits them side by side.
 */
export default function ConnectionMeters({ synchro, heat, showHeat = false, mobile: forcedMobile, resetKey = null }) {
  const detected = useIsMobileLayout();
  const mobile = forcedMobile ?? detected;
  const hasSynchro = Boolean(synchro) && Number.isFinite(Number(synchro.strength));
  const tier = hasSynchro ? synchroTierFor(synchro.strength) : null;
  const { delta: synchroDelta } = useMeterDelta(hasSynchro ? clamp(synchro.strength) : null, {
    resetKey,
  });
  const heatValue = clamp(heat);
  const { delta: heatDelta } = useMeterDelta(showHeat ? heatValue : null, { resetKey });
  const heatBar =
    heatValue >= 80 ? "bg-rose-500" : heatValue >= 40 ? "bg-amber-500" : heatValue >= 15 ? "bg-yellow-500" : "bg-primary/30";

  if (!hasSynchro && !showHeat) return null;

  return (
    <div
      data-layout={mobile ? "mobile" : "desktop"}
      className={mobile ? "flex w-full flex-col gap-1.5" : "flex flex-row items-start gap-4"}
    >
      {hasSynchro && (
        <Meter
          id="synchro"
          icon={<Link2 className="h-3 w-3 text-cyan-400" />}
          name="Synchro"
          caption="Long-term bond. Grows over time and rituals; does not cool off."
          valueLabel={tier.label}
          value={synchro.strength}
          ticks={SYNCHRO_TIERS.filter((t) => t.min > 0).map((t) => t.min)}
          barClass="bg-gradient-to-r from-cyan-600 to-cyan-300"
          mobile={mobile}
          delta={synchroDelta}
        />
      )}
      {showHeat && (
        <Meter
          id="heat"
          icon={<Flame className="h-3 w-3 text-amber-400" />}
          name="Heat"
          caption="Right-now intensity. Rises in the moment and cools when you pause."
          valueLabel={heatValue >= 80 ? "Intense" : heatValue >= 40 ? "Warm" : heatValue >= 15 ? "Stirring" : "Calm"}
          value={heatValue}
          ticks={[15, 40, 80]}
          barClass={heatBar}
          mobile={mobile}
          delta={heatDelta}
        />
      )}
    </div>
  );
}
