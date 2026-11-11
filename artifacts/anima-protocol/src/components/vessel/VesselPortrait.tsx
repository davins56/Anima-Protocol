/**
 * Inline chat-header portrait. Renders nothing (caller keeps its avatar image)
 * until the character has a saved vessel; the 3D chunk is lazy-loaded.
 */
import { lazy, Suspense, useMemo } from "react";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { expressionFor } from "@/lib/vessel/emotion";
import { moodToEmotion } from "@/lib/vessel/emotionState";
import { traitsFor } from "@/lib/vessel/vesselTraits";
import { useVesselEmotion } from "@/hooks/useVesselEmotion";

const VesselCanvas = lazy(() => import("./VesselCanvas"));

export const VESSEL_PORTRAIT_ENABLED = import.meta.env.VITE_VESSEL_PORTRAIT !== "0";

type Props = { characterId?: string | null; name?: string | null; mood?: string | null; intensity?: number; fallback: React.ReactNode; className?: string };

export default function VesselPortrait({ characterId, name, mood, intensity, fallback, className }: Props) {
  const { vessel } = useCharacterVessel(VESSEL_PORTRAIT_ENABLED ? characterId : null);
  const expression = useMemo(() => expressionFor(mood, intensity), [mood, intensity]);
  const traits = useMemo(() => traitsFor({ id: characterId, name }), [characterId, name]);
  const target = useMemo(() => moodToEmotion(mood, intensity), [mood, intensity]);
  // 5 Hz is plenty for a 12 fps portrait; the portrait renders no aura particles.
  const { shift } = useVesselEmotion(traits, target, 5);
  if (!vessel) return <>{fallback}</>;
  return (
    <Suspense fallback={fallback}>
      <VesselCanvas config={vessel.config} expression={expression} shift={shift} mode="portrait" className={className || "w-full h-full"} />
    </Suspense>
  );
}
