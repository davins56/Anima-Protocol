/**
 * Emotion → vessel-shift integrator. Runs at a low fixed rate (default 10 Hz,
 * off the render loop) and only re-renders React when the quantised shift
 * changes; per-frame motion lives inside <VesselAura> (useFrame + refs).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { stepEmotion, type EmotionState } from "@/lib/vessel/emotionState";
import { computeVesselShift, shiftKey, type VesselShift } from "@/lib/vessel/emotionShift";
import type { CompanionTraits } from "@/lib/vessel/vesselTraits";

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function useVesselEmotion(traits: CompanionTraits, target: EmotionState | null, hz = 10) {
  const reduced = useMemo(prefersReducedMotion, []);
  const emotion = useRef<EmotionState>(traits.baseline);
  const targetRef = useRef<EmotionState | null>(target);
  targetRef.current = target;
  const [shift, setShift] = useState<VesselShift>(() => computeVesselShift(traits.baseline, traits, { reducedMotion: reduced }));
  const key = useRef(shiftKey(shift));

  useEffect(() => {
    emotion.current = traits.baseline;
    let last = performance.now();
    const id = window.setInterval(() => {
      if (document.hidden) return;
      const now = performance.now();
      const dt = Math.min(0.5, (now - last) / 1000);
      last = now;
      emotion.current = stepEmotion(emotion.current, targetRef.current, traits.baseline, dt, traits.inertia);
      const next = computeVesselShift(emotion.current, traits, { reducedMotion: reduced });
      const k = shiftKey(next);
      if (k !== key.current) {
        key.current = k;
        setShift(next);
      }
    }, 1000 / hz);
    return () => window.clearInterval(id);
  }, [traits, hz, reduced]);

  return { shift, emotion };
}
