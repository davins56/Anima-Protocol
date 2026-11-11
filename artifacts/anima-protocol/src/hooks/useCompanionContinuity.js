import { useEffect, useState } from "react";
import { animaApi } from "@/api/animaApi";

/**
 * Loads companion state at session start for a surface (chat/photo/vessel/resonance).
 * Decoration only: failures resolve to null and never block the page.
 */
export function useCompanionContinuity(characterId, { surface = "chat", name = "", api = animaApi } = {}) {
  const [data, setData] = useState(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    if (!characterId || !api?.continuity?.load) return undefined;
    api.continuity
      .load(characterId, { surface, name })
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null));
    return () => {
      alive = false;
    };
  }, [characterId, surface, name, api]);
  return data;
}
