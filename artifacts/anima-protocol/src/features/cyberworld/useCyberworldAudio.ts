import { useCallback, useEffect, useState } from "react";
import { CyberworldAudio, readInitialMuted, writeMuted } from "./audio";

/**
 * One procedural audio engine per page. Unlocks on the first pointer/key
 * gesture (autoplay rules); the mute choice persists in localStorage.
 */
export function useCyberworldAudio() {
  const [engine] = useState(() => new CyberworldAudio(readInitialMuted()));
  const [muted, setMutedState] = useState(() => engine.isMuted);

  useEffect(() => {
    const unlock = () => engine.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
      engine.dispose();
    };
  }, [engine]);

  const toggleMuted = useCallback(() => {
    const next = !engine.isMuted;
    engine.setMuted(next);
    writeMuted(next);
    setMutedState(next);
    if (!next) engine.blip();
  }, [engine]);

  return { muted, toggleMuted, sfx: engine };
}
