import { useCallback, useMemo, useState } from "react";
import {
  detectRendererCapabilities,
  lowerRendererQuality,
  raiseRendererQuality,
  selectRendererQuality,
} from "@/lib/rendererQuality";

export function useRendererQuality() {
  const ceiling = useMemo(
    () => selectRendererQuality(detectRendererCapabilities()),
    [],
  );
  const [quality, setQuality] = useState(ceiling);

  const handleDecline = useCallback(() => {
    setQuality((current) => lowerRendererQuality(current));
  }, []);

  const handleIncline = useCallback(() => {
    setQuality((current) => raiseRendererQuality(current, ceiling));
  }, [ceiling]);

  return { quality, handleDecline, handleIncline };
}
