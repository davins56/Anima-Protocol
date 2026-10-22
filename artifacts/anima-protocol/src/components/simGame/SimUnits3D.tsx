/**
 * Units in W-space: the navi (existing SerenityFigure → AnimaVesselMesh) and
 * viruses (existing VirusFigure) wrapped in a group placed every frame from
 * the interpolated sim pose, plus the phase-shift dissolve and afterimages.
 */
import { memo, useMemo, useRef, type ReactNode } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { bandAt, type Unit } from "@workspace/sim-core";
import { SerenityFigure, VirusFigure } from "@/components/battle/BattleFigures3D";
import { unitPose } from "@/lib/simClient/wSpace";
import type { FixedStepLoop } from "@/lib/simClient/fixedStepLoop";
import { createDissolveUniforms, patchTree, type DissolveUniforms } from "./dissolve";
import { planeYaw, poseWorld, setTreeOpacity } from "./simSpace3D";
import type { SimFxStore } from "./simStore";

type DissolveDrive = { amount: number; color: string };

/** Applies one shared dissolve uniform set to every material underneath. */
function DissolveGroup({ drive, children }: { drive: () => DissolveDrive; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  const state = useRef<{ u: DissolveUniforms | null; frame: number }>({ u: null, frame: 0 });
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const st = state.current;
    st.u ??= createDissolveUniforms();
    // Patch early and periodically (quality changes can swap materials) so a shift never hitches on compile.
    if (st.frame++ % 30 === 0) patchTree(g, st.u);
    const d = drive();
    st.u.uDissolve.value = d.amount;
    st.u.uDissolveEdge.value.set(d.color);
    g.getWorldPosition(st.u.uDissolveOrigin.value);
    g.visible = d.amount < 0.995;
  });
  return <group ref={group}>{children}</group>;
}

const GHOST_PARTS = (
  <>
    <mesh position={[0, 0.72, 0]}>
      <capsuleGeometry args={[0.2, 0.62, 4, 10]} />
      <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
    <mesh position={[0, 1.32, 0]}>
      <sphereGeometry args={[0.16, 12, 10]} />
      <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
    </mesh>
    {[-1, 1].map((d) => (
      <mesh key={d} position={[d * 0.36, 0.95, -0.08]} rotation={[0, 0, d * 0.5]} scale={[0.3, 0.55, 0.06]}>
        <octahedronGeometry args={[1, 0]} />
        <meshBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    ))}
  </>
);

/** Ghost trail left along W during a phase-shift. */
function Afterimages({ loop, unitId, count = 7, life = 0.65 }: { loop: FixedStepLoop; unitId: string; count?: number; life?: number }) {
  const ghosts = useRef<Array<THREE.Group | null>>([]);
  const trail = useRef<{ samples: Array<{ pos: THREE.Vector3; yaw: number; t: number; color: THREE.Color }>; last: number }>({ samples: [], last: -1 });
  useFrame((state) => {
    const now = state.clock.elapsedTime;
    const tr = trail.current;
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, unitId);
    if (pose && pose.progress !== null && now - tr.last > 0.05) {
      tr.last = now;
      tr.samples.unshift({ pos: poseWorld(pose), yaw: planeYaw(pose.planeW), t: now, color: new THREE.Color(bandAt(pose.w).color) });
      tr.samples.length = Math.min(tr.samples.length, count);
    }
    for (let i = 0; i < count; i++) {
      const g = ghosts.current[i];
      const s = tr.samples[i];
      if (!g) continue;
      const age = s ? now - s.t : life;
      g.visible = age < life;
      if (!s || !g.visible) continue;
      g.position.copy(s.pos);
      g.rotation.y = s.yaw;
      g.scale.setScalar(1 + age * 0.35);
      setTreeOpacity(g, 0.42 * (1 - age / life) * (1 - i / (count + 1)), s.color);
    }
  });
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <group
          key={i}
          ref={(el) => {
            ghosts.current[i] = el;
          }}
          visible={false}
        >
          {GHOST_PARTS}
        </group>
      ))}
    </>
  );
}

type NaviProps = { loop: FixedStepLoop; fxStore: SimFxStore; navi: Unit; model: Record<string, unknown>; quality: Record<string, unknown> };

export const SimNavi = memo(function SimNavi({ loop, fxStore, navi, model, quality }: NaviProps) {
  const root = useRef<THREE.Group>(null);
  const drive = useRef<DissolveDrive>({ amount: 0, color: "#8B5CF6" });
  useFrame(() => {
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, navi.id);
    if (!pose || !root.current) return;
    poseWorld(pose, root.current.position);
    root.current.rotation.y = planeYaw(pose.planeW);
    drive.current.amount = pose.dissolve;
    drive.current.color = bandAt(pose.w).color;
  });
  return (
    <>
      <group ref={root}>
        <DissolveGroup drive={() => drive.current}>
          <SerenityFigure
            model={model}
            anchored
            flinch={fxStore.flinching(navi.id, loop.curr.tick)}
            hpRatio={navi.maxHp > 0 ? navi.hp / navi.maxHp : 1}
            facing={1}
            quality={quality}
          />
        </DissolveGroup>
      </group>
      <Afterimages loop={loop} unitId={navi.id} />
    </>
  );
});

const VIRUS_SILHOUETTES = new Set(["shade", "static", "mettaur", "halo", "aegis"]);

type VirusProps = { loop: FixedStepLoop; fxStore: SimFxStore; unit: Unit };

export const SimVirus = memo(function SimVirus({ loop, fxStore, unit }: VirusProps) {
  const root = useRef<THREE.Group>(null);
  const drive = useRef<DissolveDrive>({ amount: 0, color: "#ef4444" });
  const color = bandAt(unit.w).color;
  const model = useMemo(() => ({ color, silhouette: VIRUS_SILHOUETTES.has(unit.kind) ? unit.kind : "mettaur" }), [unit.kind, color]);
  useFrame(() => {
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, unit.id);
    if (!pose || !root.current) return;
    poseWorld(pose, root.current.position);
    root.current.rotation.y = planeYaw(pose.planeW);
    const deadAt = fxStore.defeatedAt.get(unit.id);
    const death = deadAt === undefined ? 0 : Math.min(1, (loop.renderTick - deadAt) / 14);
    drive.current.amount = Math.max(pose.dissolve, death);
    drive.current.color = bandAt(pose.w).color;
  });
  return (
    <>
      <group ref={root}>
        <DissolveGroup drive={() => drive.current}>
          <VirusFigure model={model} anchored flinch={fxStore.flinching(unit.id, loop.curr.tick)} hpRatio={unit.maxHp > 0 ? unit.hp / unit.maxHp : 1} />
        </DissolveGroup>
      </group>
      <Afterimages loop={loop} unitId={unit.id} count={4} life={0.45} />
    </>
  );
});
