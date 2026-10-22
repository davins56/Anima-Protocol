/**
 * Consequence visuals in the arena: hit tracers + impacts (projectile-vs-unit
 * is resolved by sim-core on the grid; this only *shows* it), terrain-change
 * bursts, PhaseGate portals spanning W, Purify bloom, corruption static burst,
 * virus deletion shards, and the W-lattice whose XW rotation tracks the dial.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { Portal } from "@workspace/sim-core";
import { TESSERACT_LINE_FLOATS, writeTesseractLinePositions } from "@/lib/tesseract4d";
import { unitPose, wRotation } from "@/lib/simClient/wSpace";
import type { Fx } from "@/lib/simClient/fx";
import type { FixedStepLoop } from "@/lib/simClient/fixedStepLoop";
import { cellWorld, localToWorld, setTreeOpacity, useUnitAnchor } from "./simSpace3D";

const life01 = (loop: FixedStepLoop, f: Fx) => Math.min(1, Math.max(0, (loop.renderTick - f.tick) / f.life));

function Shot({ loop, fx }: { loop: FixedStepLoop; fx: Extract<Fx, { kind: "shot" }> }) {
  const m = useRef<THREE.Mesh>(null);
  const a = useMemo(() => cellWorld(fx.from), [fx.from]);
  const b = useMemo(() => cellWorld(fx.to), [fx.to]);
  useFrame((_, dt) => {
    if (!m.current) return;
    const p = life01(loop, fx);
    m.current.visible = loop.renderTick >= fx.tick && p < 1;
    m.current.position.lerpVectors(a, b, p);
    m.current.rotation.x += dt * 10;
  });
  return (
    <mesh ref={m} visible={false}>
      <octahedronGeometry args={[0.13, 0]} />
      <meshBasicMaterial color={fx.color} toneMapped={false} />
    </mesh>
  );
}

function Burst({ loop, fx, at, color, scale = 1, shape = "ring" }: { loop: FixedStepLoop; fx: Fx; at: THREE.Vector3; color: string; scale?: number; shape?: "ring" | "shards" }) {
  const g = useRef<THREE.Group>(null);
  useFrame(() => {
    if (!g.current) return;
    const p = life01(loop, fx);
    g.current.visible = loop.renderTick >= fx.tick && p < 1;
    g.current.scale.setScalar(scale * (0.3 + p * 1.4));
    setTreeOpacity(g.current, 0.9 * (1 - p));
  });
  const mat = <meshBasicMaterial color={color} transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} side={THREE.DoubleSide} />;
  return (
    <group ref={g} position={at} visible={false}>
      {shape === "ring" ? (
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.35, 0.5, 32]} />
          {mat}
        </mesh>
      ) : (
        Array.from({ length: 8 }, (_, i) => (
          <mesh key={i} position={[Math.cos(i * 0.785) * 0.4, (i % 3) * 0.15, Math.sin(i * 0.785) * 0.4]} rotation={[i, i * 0.5, 0]}>
            <tetrahedronGeometry args={[0.1, 0]} />
            {mat}
          </mesh>
        ))
      )}
    </group>
  );
}

/** Purify: a violet column + expanding halo around the navi. */
function PurifyBloom({ loop, fx }: { loop: FixedStepLoop; fx: Fx }) {
  const anchor = useUnitAnchor(loop, "navi");
  const col = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const p = life01(loop, fx);
    if (col.current) {
      col.current.scale.set(1 + p, 1, 1 + p);
      (col.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - p);
    }
    if (halo.current) {
      halo.current.scale.setScalar(0.5 + p * 3);
      (halo.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p);
    }
  });
  return (
    <group ref={anchor}>
      <mesh ref={col} position={[0, 1.6, 0]}>
        <cylinderGeometry args={[0.35, 0.5, 3.2, 24, 1, true]} />
        <meshBasicMaterial color="#c4b5fd" transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      <mesh ref={halo} position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.6, 0.75, 48]} />
        <meshBasicMaterial color="#8B5CF6" transparent blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
    </group>
  );
}

/** Corruption: band-coloured static cage that snaps around the navi. */
function CorruptionBurst({ loop, fx, color }: { loop: FixedStepLoop; fx: Fx; color: string }) {
  const anchor = useUnitAnchor(loop, "navi");
  const cage = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    if (!cage.current) return;
    const p = life01(loop, fx);
    const jitter = Math.sin(state.clock.elapsedTime * 80) * 0.06;
    cage.current.scale.setScalar(1.1 + jitter + p * 0.6);
    cage.current.rotation.y = state.clock.elapsedTime * 6;
    (cage.current.material as THREE.MeshBasicMaterial).opacity = 0.85 * (1 - p);
  });
  return (
    <group ref={anchor}>
      <mesh ref={cage} position={[0, 0.85, 0]}>
        <icosahedronGeometry args={[0.85, 1]} />
        <meshBasicMaterial color={color} wireframe transparent toneMapped={false} />
      </mesh>
    </group>
  );
}

/** PhaseGate: rings at both ends plus a beam through W-space. */
function PhaseGatePortal({ loop, portal }: { loop: FixedStepLoop; portal: Portal }) {
  const a = useMemo(() => cellWorld(portal.a, 0.05), [portal.a]);
  const b = useMemo(() => cellWorld(portal.b, 0.05), [portal.b]);
  const rings = useRef<Array<THREE.Mesh | null>>([]);
  const beam = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([a.clone().setY(a.y + 0.6), b.clone().setY(b.y + 0.6)]);
    return g;
  }, [a, b]);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const left = Math.max(0, portal.closesAt - loop.renderTick);
    const fade = Math.min(1, left / 30);
    for (const r of rings.current) {
      if (!r) continue;
      r.rotation.z = t * 2.4;
      r.scale.setScalar(0.9 + Math.sin(t * 4) * 0.06);
      (r.material as THREE.MeshBasicMaterial).opacity = 0.9 * fade;
    }
  });
  return (
    <>
      {[a, b].map((p, i) => (
        <mesh key={i} ref={(el) => (rings.current[i] = el)} position={[p.x, p.y + 0.6, p.z]}>
          <torusGeometry args={[0.42, 0.05, 10, 40]} />
          <meshBasicMaterial color="#14B8A6" transparent toneMapped={false} />
        </mesh>
      ))}
      <lineSegments geometry={beam}>
        <lineBasicMaterial color="#5eead4" transparent opacity={0.7} toneMapped={false} />
      </lineSegments>
    </>
  );
}

export function SimFxLayer({ loop, fx, portals }: { loop: FixedStepLoop; fx: Fx[]; portals: Portal[] }) {
  return (
    <>
      {portals.map((p) => (
        <PhaseGatePortal key={p.id} loop={loop} portal={p} />
      ))}
      {fx.map((f) => {
        switch (f.kind) {
          case "shot":
            return <Shot key={f.id} loop={loop} fx={f} />;
          case "impact":
            return <Burst key={f.id} loop={loop} fx={f} at={cellWorld(f.cell, 0.1)} color={f.color} />;
          case "panel":
            return <Burst key={f.id} loop={loop} fx={f} at={cellWorld(f.cell, 0.06)} color={PANEL_FX_COLOR[f.to]} scale={1.3} />;
          case "defeat":
            return <Burst key={f.id} loop={loop} fx={f} at={cellWorld(f.cell, 0.5)} color={f.color} shape="shards" scale={1.6} />;
          case "purify":
            return <PurifyBloom key={f.id} loop={loop} fx={f} />;
          case "corrupt":
            return <CorruptionBurst key={f.id} loop={loop} fx={f} color="#ef4444" />;
          default:
            return null;
        }
      })}
    </>
  );
}

const PANEL_FX_COLOR = { normal: "#67e8f9", cracked: "#fef3c7", broken: "#ef4444", poison: "#c026d3", holy: "#facc15" } as const;

/**
 * The 4th axis made legible: a tesseract centred on the navi's plane whose XW
 * rotation is the navi's W (one full turn across the spectrum), so tuning
 * visibly rotates the hypercube through the hidden axis.
 */
export function WLattice({ loop, color }: { loop: FixedStepLoop; color: string }) {
  const geom = useRef<THREE.BufferGeometry>(null);
  const group = useRef<THREE.Group>(null);
  const positions = useMemo(() => new Float32Array(TESSERACT_LINE_FLOATS), []);
  useFrame((state) => {
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, "navi");
    if (!pose) return;
    const t = state.clock.elapsedTime;
    writeTesseractLinePositions(positions, { xw: wRotation(pose.w), yw: t * 0.12, zw: Math.sin(t * 0.2) * 0.3, xy: t * 0.04 }, 2.45, 1.9);
    const attr = geom.current?.attributes?.position;
    if (attr) attr.needsUpdate = true;
    if (group.current) {
      localToWorld([0, 3.1, -2.8], pose.planeW, group.current.position);
    }
  });
  return (
    <group ref={group}>
      <lineSegments>
        <bufferGeometry ref={geom}>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={color} transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </lineSegments>
    </group>
  );
}
