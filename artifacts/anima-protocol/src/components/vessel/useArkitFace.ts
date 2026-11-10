/** Per-frame ARKit face driver for plain GLB vessels (blink loop, smile, jaw ← speech openness). */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import type { Object3D } from "three";
import type { Expression } from "@/lib/vessel/emotion";
import { applyArkitWeights, arkitFaceWeights, findArkitMeshes, type ArkitFaceWeights } from "@/lib/vessel/arkitFace";
import { createBlinker } from "@/lib/vessel/vrmExpressions";
import { speechOpenness } from "@/lib/vessel/vrmVisemes";

export function useArkitFace(
  scene: Object3D | null | undefined,
  opts: {
    expression?: Expression | null;
    speaking?: boolean;
    audioLevel?: (() => number | null | undefined) | null;
    /** Fixed weights (dev/lab); merged over the live ones. */
    override?: ArkitFaceWeights | null;
  },
) {
  const bindings = useMemo(() => (scene ? findArkitMeshes(scene) : []), [scene]);
  const blinker = useMemo(() => createBlinker(), []);
  const jaw = useRef(0);
  const o = useRef(opts);
  o.current = opts;
  useFrame(({ clock }, delta) => {
    if (!bindings.length) return;
    const { expression, speaking = false, audioLevel, override } = o.current;
    const dt = Math.min(0.1, delta);
    const open = speechOpenness(clock.elapsedTime * 1000, speaking, audioLevel ? audioLevel() : null);
    jaw.current += (open - jaw.current) * Math.min(1, dt / 0.05);
    const blink = blinker.update(dt, expression ? Math.max(0, expression.smile) : 0);
    applyArkitWeights(bindings, { ...arkitFaceWeights({ blink, openness: jaw.current, expression }), ...(override ?? {}) });
  });
  return bindings.length > 0;
}
