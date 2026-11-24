/**
 * Anima Essence non-humanoid vessel forms (crystal, orb, chalice, flame, tree)
 * and the Sapphire Resonance aura, shared by VesselModel (studio, presence,
 * Essence preview) and AnimaVesselMesh (Cyberworld / net surfaces, via netForm).
 *
 * Cheap by design (iPad Safari, #728/#729): a handful of low-segment meshes,
 * MeshStandard / MeshBasic only (no transmission, no render targets, no
 * post-processing, so no bloom on any tier), one InstancedMesh for the aura
 * motes, everything created inside components (never at module load) and
 * disposed on unmount. Built in the humanoid's space: feet at y=0, ~1.9 tall.
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { SAPPHIRE, silverToneColor, type NetForm } from "@/lib/vessel/vesselCalibration";

export type VesselFormProps = {
  form: NetForm;
  /** Core / heart colour (eye colour). */
  coreColor: string;
  /** Silver / metal tint; defaults to the neutral midpoint. */
  silver?: string | null;
  /** Emissive strength 0..1; defaults to 0.5. */
  glow?: number | null;
  /** Sapphire Resonance aura 0..1, or null for none. */
  aura?: number | null;
  /** Aura mote budget (quality tier); 0 keeps just the shell + light. */
  budget?: number;
  hd?: boolean;
  hologram?: boolean;
  reducedMotion?: boolean;
};

type Mats = { metal: THREE.Material; core: THREE.Material; shell: THREE.Material; flameOuter: THREE.Material; flameInner: THREE.Material };

function useFormMaterials(coreColor: string, silver: string, glow: number, hologram: boolean): Mats {
  const mats = useMemo<Mats>(() => {
    const additive = (color: string, opacity: number) =>
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
    if (hologram) {
      return { metal: additive(silver, 0.3), core: additive(coreColor, 0.45), shell: additive(silver, 0.12), flameOuter: additive(coreColor, 0.3), flameInner: additive("#ffffff", 0.35) };
    }
    return {
      metal: new THREE.MeshStandardMaterial({ color: silver, metalness: 0.85, roughness: 0.28, flatShading: true, emissive: new THREE.Color(silver), emissiveIntensity: 0.05 + glow * 0.2 }),
      core: new THREE.MeshStandardMaterial({ color: coreColor, metalness: 0.1, roughness: 0.35, flatShading: true, emissive: new THREE.Color(coreColor), emissiveIntensity: 0.25 + glow * 2.2, toneMapped: false }),
      shell: new THREE.MeshStandardMaterial({ color: silver, metalness: 0.4, roughness: 0.15, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, emissive: new THREE.Color(coreColor), emissiveIntensity: glow * 0.4 }),
      flameOuter: additive(coreColor, 0.22 + glow * 0.35),
      flameInner: additive(silver, 0.3 + glow * 0.45),
    };
  }, [coreColor, silver, glow, hologram]);
  useEffect(() => () => Object.values(mats).forEach((m) => m.dispose()), [mats]);
  return mats;
}

function Crystal({ m, seg }: { m: Mats; seg: number }) {
  return (
    <group>
      <mesh material={m.core} position={[0, 1.15, 0]} scale={[1, 2.1, 1]}>
        <octahedronGeometry args={[0.34, 0]} />
      </mesh>
      <mesh material={m.shell} position={[0, 1.15, 0]} scale={[1.18, 2.3, 1.18]}>
        <octahedronGeometry args={[0.34, 0]} />
      </mesh>
      {[0, 1, 2].map((i) => {
        const a = (i / 3) * Math.PI * 2;
        return (
          <mesh key={i} material={m.metal} position={[Math.cos(a) * 0.5, 0.55 + i * 0.08, Math.sin(a) * 0.5]} rotation={[0.3, a, 0.2]} scale={[1, 1.8, 1]}>
            <octahedronGeometry args={[0.08, 0]} />
          </mesh>
        );
      })}
      <mesh material={m.metal} position={[0, 0.04, 0]}>
        <cylinderGeometry args={[0.36, 0.42, 0.08, Math.max(6, seg)]} />
      </mesh>
    </group>
  );
}

function Orb({ m, seg }: { m: Mats; seg: number }) {
  return (
    <group>
      <mesh material={m.core} position={[0, 1.1, 0]}>
        <icosahedronGeometry args={[0.34, seg > 10 ? 3 : 2]} />
      </mesh>
      <mesh material={m.shell} position={[0, 1.1, 0]}>
        <sphereGeometry args={[0.48, seg * 2, seg]} />
      </mesh>
      <mesh material={m.metal} position={[0, 1.1, 0]} rotation={[Math.PI / 2.4, 0, 0.2]}>
        <torusGeometry args={[0.62, 0.012, 6, seg * 6]} />
      </mesh>
      <mesh material={m.metal} position={[0, 1.1, 0]} rotation={[Math.PI / 1.7, 0.6, 0]}>
        <torusGeometry args={[0.56, 0.008, 6, seg * 6]} />
      </mesh>
    </group>
  );
}

function Chalice({ m, seg }: { m: Mats; seg: number }) {
  const profile = useMemo(
    () =>
      [
        [0.0, 0.0], [0.32, 0.0], [0.34, 0.04], [0.12, 0.12], [0.06, 0.3], [0.05, 0.75], [0.09, 0.85],
        [0.3, 1.0], [0.42, 1.22], [0.46, 1.42], [0.44, 1.44], [0.4, 1.24], [0.28, 1.04], [0.0, 0.96],
      ].map(([x, y]) => new THREE.Vector2(x, y)),
    [],
  );
  return (
    <group>
      <mesh material={m.metal}>
        <latheGeometry args={[profile, Math.max(8, seg * 2)]} />
      </mesh>
      {/* what is poured in: the resonant core, held at the rim */}
      <mesh material={m.core} position={[0, 1.33, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.41, Math.max(8, seg * 2)]} />
      </mesh>
      <mesh material={m.core} position={[0, 1.42, 0]}>
        <sphereGeometry args={[0.1, seg, seg]} />
      </mesh>
    </group>
  );
}

function Flame({ m, seg, still }: { m: Mats; seg: number; still: boolean }) {
  const outer = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (still) return;
    const t = clock.elapsedTime;
    const f = 1 + 0.08 * Math.sin(t * 9) * Math.sin(t * 3.7);
    outer.current?.scale.set(1 / f, f, 1 / f);
    inner.current?.scale.set(1, 1 + 0.1 * Math.sin(t * 13 + 1), 1);
    if (outer.current) outer.current.rotation.y = t * 0.6;
  });
  return (
    <group>
      <mesh ref={outer} material={m.flameOuter} position={[0, 0.95, 0]}>
        <coneGeometry args={[0.38, 1.45, Math.max(6, seg), 1, true]} />
      </mesh>
      <mesh ref={inner} material={m.flameInner} position={[0, 0.8, 0]}>
        <coneGeometry args={[0.2, 1.0, Math.max(6, seg), 1, true]} />
      </mesh>
      <mesh material={m.core} position={[0, 0.42, 0]}>
        <sphereGeometry args={[0.16, seg, seg]} />
      </mesh>
      <mesh material={m.metal} position={[0, 0.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.36, 0.035, 6, seg * 3]} />
      </mesh>
    </group>
  );
}

function Tree({ m, seg }: { m: Mats; seg: number }) {
  const branches: [number, number, number][] = [
    [0.9, 0.6, 0],
    [1.05, -0.55, 2.1],
    [1.2, 0.5, 4.0],
    [1.3, -0.45, 5.4],
  ];
  const canopy: [number, number, number, number][] = [
    [0, 1.62, 0, 0.36],
    [0.32, 1.42, 0.12, 0.24],
    [-0.3, 1.46, -0.1, 0.26],
    [0.1, 1.38, -0.32, 0.22],
    [-0.12, 1.35, 0.3, 0.22],
  ];
  return (
    <group>
      <mesh material={m.metal} position={[0, 0.6, 0]}>
        <cylinderGeometry args={[0.06, 0.13, 1.2, Math.max(5, seg)]} />
      </mesh>
      {branches.map(([y, tilt, yaw], i) => (
        <group key={i} position={[0, y, 0]} rotation={[0, yaw, tilt]}>
          <mesh material={m.metal} position={[0, 0.2, 0]}>
            <cylinderGeometry args={[0.02, 0.04, 0.42, 5]} />
          </mesh>
        </group>
      ))}
      {canopy.map(([x, y, z, r], i) => (
        <mesh key={i} material={i === 0 ? m.core : m.shell} position={[x, y, z]}>
          <icosahedronGeometry args={[r, 0]} />
        </mesh>
      ))}
      <mesh material={m.core} position={[0, 1.55, 0]}>
        <icosahedronGeometry args={[0.16, 0]} />
      </mesh>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} material={m.metal} position={[Math.cos(i * 1.6) * 0.16, 0.03, Math.sin(i * 1.6) * 0.16]} rotation={[0, i * 1.6, Math.PI / 2.3]}>
          <cylinderGeometry args={[0.015, 0.04, 0.32, 4]} />
        </mesh>
      ))}
    </group>
  );
}

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/**
 * Sapphire Resonance: `strength` 0..1 sets the aura (shell opacity, mote
 * count/size). Additive, unlit meshes only: no extra light (iPad fragment
 * cost; light count stays constant when the aura toggles), no bloom. Motes
 * are one InstancedMesh.
 */
export function ResonanceAura({ strength, budget = 32, color = SAPPHIRE, still = false, center = 1.0 }: { strength: number; budget?: number; color?: string; still?: boolean; center?: number }) {
  const s = Math.max(0, Math.min(1, strength));
  const count = Math.max(0, Math.min(96, Math.round(budget * s)));
  const motes = useRef<THREE.InstancedMesh>(null);
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => [hash(i), hash(i + 0.37), hash(i + 0.71)] as const), [count]);
  const tmp = useMemo(() => ({ m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), sc: new THREE.Vector3() }), []);
  const shellMat = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.03 + s * 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.BackSide, toneMapped: false }),
    [color, s],
  );
  useEffect(() => () => shellMat.dispose(), [shellMat]);
  const place = (t: number) => {
    const m = motes.current;
    if (!m) return;
    for (let i = 0; i < count; i++) {
      const [a, b, c] = seeds[i];
      const ang = a * Math.PI * 2 + t * (0.2 + b * 0.3);
      const r = 0.55 + c * 0.35;
      const y = center - 0.8 + ((b + t * 0.05) % 1) * 1.8;
      const size = (0.01 + 0.018 * c) * (0.6 + s * 0.8);
      tmp.p.set(Math.cos(ang) * r, y, Math.sin(ang) * r);
      tmp.m.compose(tmp.p, tmp.q, tmp.sc.set(size, size, size));
      m.setMatrixAt(i, tmp.m);
    }
    m.instanceMatrix.needsUpdate = true;
  };
  useEffect(() => place(0));
  useFrame(({ clock }) => {
    if (!still) place(clock.elapsedTime);
  });
  if (s <= 0) return null;
  return (
    <group>
      <mesh material={shellMat} position={[0, center, 0]} scale={[0.75, 1.15, 0.75]}>
        <sphereGeometry args={[0.85, 16, 12]} />
      </mesh>
      {count > 0 && (
        <instancedMesh ref={motes} args={[undefined, undefined, count]} frustumCulled={false}>
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial color={color} transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
    </group>
  );
}

/** A non-humanoid calibrated vessel. Gently turns (stills under reduced motion). */
export default function VesselForm({ form, coreColor, silver, glow, aura, budget = 32, hd = false, hologram = false, reducedMotion = false }: VesselFormProps) {
  const seg = hd ? 16 : 8;
  const tint = silver || silverToneColor(50);
  const g = glow == null ? 0.5 : Math.max(0, Math.min(1, glow));
  const m = useFormMaterials(coreColor, tint, g, hologram);
  const spin = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (reducedMotion || !spin.current) return;
    const t = clock.elapsedTime;
    spin.current.rotation.y = form === "tree" || form === "chalice" ? Math.sin(t * 0.3) * 0.25 : t * 0.35;
    spin.current.position.y = form === "orb" || form === "crystal" ? Math.sin(t * 1.1) * 0.03 : 0;
  });
  return (
    <group name={`vessel-form-${form}`}>
      <group ref={spin}>
        {form === "crystal" && <Crystal m={m} seg={seg} />}
        {form === "orb" && <Orb m={m} seg={seg} />}
        {form === "chalice" && <Chalice m={m} seg={seg} />}
        {form === "flame" && <Flame m={m} seg={seg} still={reducedMotion} />}
        {form === "tree" && <Tree m={m} seg={seg} />}
      </group>
      {!hologram && <pointLight color={coreColor} intensity={0.3 + g * 1.4} distance={2.5} position={[0, 1.1, 0.4]} />}
      {aura != null && !hologram && <ResonanceAura strength={aura} budget={budget} still={reducedMotion} />}
    </group>
  );
}
