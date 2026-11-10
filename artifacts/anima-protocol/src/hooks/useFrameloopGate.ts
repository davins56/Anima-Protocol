import { useEffect, useState, useSyncExternalStore } from "react";
import { createFrameloopGate, frameloopFor, type FrameloopGate, type FrameloopMode } from "@/lib/vessel/frameloopGate";

/** A per-canvas demand gate plus the frameloop it implies. */
export function useFrameloopGate(visible: boolean): { gate: FrameloopGate; frameloop: FrameloopMode; active: boolean } {
  const [gate] = useState(createFrameloopGate);
  useEffect(() => () => gate.dispose(), [gate]);
  const active = useSyncExternalStore(gate.subscribe, gate.isActive, gate.isActive);
  return { gate, frameloop: frameloopFor({ visible, active }), active };
}
