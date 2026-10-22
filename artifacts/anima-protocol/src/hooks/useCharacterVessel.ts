import { useEffect, useState } from "react";
import { fetchVessel, onVesselChanged, type VesselRecord } from "@/lib/vessel/vesselApi";

/** Cached saved vessel for a character (null when none saved / not migrated). */
export function useCharacterVessel(characterId?: string | null) {
  const [vessel, setVessel] = useState<VesselRecord | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!characterId) {
      setVessel(null);
      return;
    }
    let live = true;
    const load = (force = false) => {
      setLoading(true);
      fetchVessel(characterId, force)
        .then((v) => live && setVessel(v))
        .catch(() => live && setVessel(null))
        .finally(() => live && setLoading(false));
    };
    load();
    const off = onVesselChanged((id) => id === characterId && load());
    return () => {
      live = false;
      off();
    };
  }, [characterId]);
  return { vessel, loading };
}
