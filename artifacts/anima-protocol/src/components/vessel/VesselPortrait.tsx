/**
 * Inline chat-header portrait. Renders nothing (caller keeps its avatar image)
 * until the character has a saved vessel; the 3D chunk is lazy-loaded.
 */
import { lazy, Suspense, useMemo } from "react";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { expressionFor } from "@/lib/vessel/emotion";

const VesselCanvas = lazy(() => import("./VesselCanvas"));

export const VESSEL_PORTRAIT_ENABLED = import.meta.env.VITE_VESSEL_PORTRAIT !== "0";

type Props = { characterId?: string | null; mood?: string | null; intensity?: number; fallback: React.ReactNode; className?: string };

export default function VesselPortrait({ characterId, mood, intensity, fallback, className }: Props) {
  const { vessel } = useCharacterVessel(VESSEL_PORTRAIT_ENABLED ? characterId : null);
  const expression = useMemo(() => expressionFor(mood, intensity), [mood, intensity]);
  if (!vessel) return <>{fallback}</>;
  return (
    <Suspense fallback={fallback}>
      <VesselCanvas config={vessel.config} expression={expression} mode="portrait" className={className || "w-full h-full"} />
    </Suspense>
  );
}
