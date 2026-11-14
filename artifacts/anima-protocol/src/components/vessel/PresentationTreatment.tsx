/**
 * Wraps a vessel subtree and applies the Appearance Studio "Character
 * presentation" (portrait | hologram | netnavi) to it. See
 * lib/vessel/presentation (option → treatment) and ./presentationMaterials
 * (how it is applied). `portrait` is the identity treatment: no work at all.
 *
 * iPad Safari (#728/#729): no extra canvases/contexts, no render targets, no
 * post-processing; outline shells only off the low tier and outside `lite`
 * views; works with demand frameloops (it invalidates once on change and
 * re-syncs on rendered frames only).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type * as THREE from "three";
import { useExperienceExtras } from "@/hooks/useExperienceExtras";
import { isIdentityTreatment, presentationTreatment, type CharacterPresentation } from "@/lib/vessel/presentation";
import { createTreatmentState, disposeTreatmentState, syncTreatment, tickTreatment, type TreatmentState } from "./presentationMaterials";

type Props = {
  children: ReactNode;
  /** Quality tier name (useRendererQuality) — "low" drops the outline. */
  tier?: string;
  /** Thumbnails / crowded scenes: rim only, no outline shells. */
  lite?: boolean;
  /** Rim / tint colour; defaults to the chat avatar cyan. */
  accent?: string | null;
  /** Force an option (previews); otherwise the applied setting is used. */
  option?: CharacterPresentation;
};

const RESYNC_EVERY = 30;

export default function PresentationTreatment({ children, tier, lite = false, accent = null, option }: Props) {
  const extras = useExperienceExtras();
  const chosen = option ?? extras.character;
  const treatment = useMemo(
    () => presentationTreatment(chosen, { tier, lite, accent, reducedMotion: extras.reducedMotion }),
    [chosen, tier, lite, accent, extras.reducedMotion],
  );
  const group = useRef<THREE.Group>(null);
  const state = useRef<TreatmentState | null>(null);
  const invalidate = useThree((s) => s.invalidate);

  useLayoutEffect(() => {
    if (isIdentityTreatment(treatment) || !group.current) return;
    const s = createTreatmentState(treatment);
    state.current = s;
    syncTreatment(group.current, s);
    return () => {
      disposeTreatmentState(s);
      if (state.current === s) state.current = null;
    };
  }, [treatment]);

  // Demand frameloops (portraits) need one frame to show the new treatment.
  useEffect(() => {
    invalidate();
  }, [treatment, invalidate]);

  useFrame(({ clock }) => {
    const s = state.current;
    if (!s || !group.current) return;
    tickTreatment(s, clock.elapsedTime);
    // Pick up late children (Suspense glTF swap, quality changes) without per-frame traversal.
    if (s.frame++ % RESYNC_EVERY === 0) syncTreatment(group.current, s);
  });

  return (
    <group ref={group} name="anima-presentation" userData={{ presentation: treatment.option }}>
      {children}
    </group>
  );
}
