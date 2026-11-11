/** Per-frame ARKit face driver for plain GLB vessels (blink loop, smile, jaw ← speech openness). */
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { Object3D } from "three";
import type { Expression } from "@/lib/vessel/emotion";
import { applyArkitWeights, arkitFaceWeights, findArkitMeshes, type ArkitFaceWeights } from "@/lib/vessel/arkitFace";
import { createBlinker } from "@/lib/vessel/vrmExpressions";
import { speechOpenness, visemeWeights } from "@/lib/vessel/vrmVisemes";

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
  const invalidate = useThree((s) => s.invalidate);
  useFrame(({ clock }, delta) => {
    if (!bindings.length) return;
    const { expression, speaking = false, audioLevel, override } = o.current;
    const dt = Math.min(0.1, delta);
    const tMs = clock.elapsedTime * 1000;
    const open = speechOpenness(tMs, speaking, audioLevel ? audioLevel() : null);
    // Rounded-lip share of the current viseme (ou/oh) shapes funnel/pucker on rigs that have them.
    const vw = speaking ? visemeWeights(tMs, 1, null) : null;
    const round = vw ? Math.min(1, (vw.ou ?? 0) + (vw.oh ?? 0)) : 0;
    jaw.current += (open - jaw.current) * Math.min(1, dt / 0.05);
    const blink = blinker.update(dt, expression ? Math.max(0, expression.smile) : 0);
    applyArkitWeights(bindings, { ...arkitFaceWeights({ blink, openness: jaw.current, expression, round }), ...(override ?? {}) });
    // Demand-frameloop hosts: keep frames coming while a blink or jaw move is in
    // flight so they stay smooth, then let the canvas rest.
    if (blink > 0 || speaking || Math.abs(open - jaw.current) > 0.002) invalidate();
  });
  return bindings.length > 0;
}
