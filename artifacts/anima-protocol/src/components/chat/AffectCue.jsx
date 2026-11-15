// @ts-check
import { cuePhrase, cueVisual, REUNION_ANNOUNCEMENT } from "@/lib/emotionCues";

/**
 * Soft dot/ring cue for a companion's felt state (#765, ANIMA_EMOTIONS on).
 * No labels and no numbers: colour, glow and a slow breath come from the
 * sanitized `dims`, a dim outer ring shows an undertone, and the tooltip /
 * screen-reader text is one sentence from the fixed phrase table.
 * Animation is `motion-safe` only, so reduced-motion users get a still dot.
 *
 * @param {{
 *   cue: import("@/lib/emotionCues").AffectCue | null,
 *   name?: string | null,
 *   reunion?: boolean,
 *   size?: "sm" | "md",
 *   testId?: string,
 * }} props
 */
export default function AffectCue({ cue, name, reunion = false, size = "md", testId = "affect-cue" }) {
  const phrase = cuePhrase(cue, name);
  const v = cueVisual(cue);
  const dot = size === "sm" ? "w-1.5 h-1.5" : "w-2 h-2";
  const ring = size === "sm" ? "w-3 h-3" : "w-4 h-4";
  return (
    <>
    <span
      className={`relative inline-flex items-center justify-center flex-shrink-0 ${ring}`}
      role="img"
      aria-label={phrase}
      title={phrase}
      data-testid={testId}
      data-reunion={reunion ? "true" : undefined}
    >
      {cue?.undertone ? (
        <span
          aria-hidden="true"
          data-testid={`${testId}-undertone`}
          className="absolute inset-0 rounded-full border transition-opacity duration-1000 motion-reduce:transition-none"
          style={{ borderColor: v.color, opacity: v.undertoneOpacity }}
        />
      ) : null}
      {reunion ? (
        <span
          aria-hidden="true"
          data-testid={`${testId}-reunion`}
          className="absolute inset-0 rounded-full motion-safe:animate-ping motion-reduce:opacity-30"
          style={{
            backgroundColor: v.color,
            opacity: 0.25,
            animationDuration: "2.4s",
            animationIterationCount: 2,
          }}
        />
      ) : null}
      <span
        aria-hidden="true"
        className={`relative rounded-full ${dot} motion-safe:animate-pulse transition-colors duration-1000 motion-reduce:transition-none`}
        style={{
          backgroundColor: v.color,
          opacity: v.opacity,
          boxShadow: `0 0 ${v.glowPx}px 1px ${v.color}`,
          animationDuration: `${v.breathSeconds}s`,
        }}
      />
    </span>
    {reunion ? (
      <span className="sr-only" aria-live="polite" data-testid={`${testId}-announce`}>
        {REUNION_ANNOUNCEMENT}
      </span>
    ) : null}
    </>
  );
}
