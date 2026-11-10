/**
 * Chat-header portrait: a 2D snapshot of the saved vessel (no WebGL in the
 * chat header). Shows the latest Vessel Studio render, cropped to the head,
 * with a mood-tinted ring. Always a still image: no WebGL, no animation, not
 * even while a reply streams or the voice plays. Falls back to the caller's avatar while loading, when
 * no vessel/snapshot is saved, or on any error. Live 3D starts only in the
 * expanded presence stage or Vessel Studio.
 */
import { useEffect, useMemo, useState } from "react";
import { useCharacterVessel } from "@/hooks/useCharacterVessel";
import { moodToEmotion } from "@/lib/vessel/emotionState";
import { computeVesselShift } from "@/lib/vessel/emotionShift";
import { traitsFor } from "@/lib/vessel/vesselTraits";
import { loadVesselSnapshot } from "@/lib/vessel/vesselSnapshot";

export const VESSEL_PORTRAIT_ENABLED = import.meta.env.VITE_VESSEL_PORTRAIT !== "0";

type Props = {
  characterId?: string | null;
  name?: string | null;
  mood?: string | null;
  intensity?: number;
  /** Accepted for API compatibility; the header stays still while speaking. */
  speaking?: boolean;
  fallback: React.ReactNode;
  className?: string;
};

function useSnapshotUrl(characterId: string | null | undefined, path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!characterId || !path) return;
    let live = true;
    loadVesselSnapshot(characterId, path).then((u) => live && setUrl(u));
    return () => {
      live = false;
    };
  }, [characterId, path]);
  return url;
}

export default function VesselPortrait({ characterId, name, mood, intensity, fallback, className }: Props) {
  const { vessel } = useCharacterVessel(VESSEL_PORTRAIT_ENABLED ? characterId : null);
  const url = useSnapshotUrl(vessel ? characterId : null, vessel?.snapshot_path);
  const traits = useMemo(() => traitsFor({ id: characterId, name }), [characterId, name]);
  // Same shift colour the 3D vessel uses, computed once per mood change (no ticking).
  const ring = useMemo(
    () => (vessel ? computeVesselShift(moodToEmotion(mood, intensity), traits).color || vessel.config.effects.color : null),
    [vessel, mood, intensity, traits],
  );
  if (!vessel) return <>{fallback}</>;
  return (
    <span
      data-vessel-portrait={url ? "snapshot" : "fallback"}
      className={`relative block overflow-hidden ${className || "w-full h-full"}`}
      style={ring ? { boxShadow: `inset 0 0 0 1px ${ring}, 0 0 6px ${ring}66` } : undefined}
    >
      {url ? (
        <img
          src={url}
          alt={name || "Vessel"}
          draggable={false}
          className="w-full h-full object-cover"
          // Studio renders are full-body; the head sits ~25% from the top.
          style={{ transform: "scale(2.4)", transformOrigin: "50% 24%" }}
        />
      ) : (
        fallback
      )}
    </span>
  );
}
