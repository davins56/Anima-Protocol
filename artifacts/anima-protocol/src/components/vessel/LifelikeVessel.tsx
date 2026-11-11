/**
 * Lifelike vessel base (bundled high-detail rigged GLB, see lib/vessel/lifelikeBase).
 * - SkeletonUtils clone per renderer (skinned meshes can't share a skeleton).
 * - Role-named materials become physical skin / eyes / hair (lib/vessel/lifelikeMaterials).
 * - ARKit morphs: blink, smile, jaw ← speech, funnel/pucker, brows, frown (useArkitFace).
 * - Idle rig motion: relaxed arms, breathing, head follows the pointer, mood tilt.
 * - Serenity's angelic form: crystal wings + halo built in-house (no external assets).
 */
import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { Expression } from "@/lib/vessel/emotion";
import type { ArkitFaceWeights } from "@/lib/vessel/arkitFace";
import type { VesselConfig } from "@/lib/vessel/vesselConfig";
import { upgradeLifelikeMaterials, type LifelikeTier } from "@/lib/vessel/lifelikeMaterials";
import { detectRendererCapabilities, selectRendererQuality } from "@/lib/rendererQuality";
import { useArkitFace } from "./useArkitFace";

type Props = {
  path: string;
  config: VesselConfig;
  expression: Expression;
  speaking?: boolean;
  audioLevel?: (() => number | null | undefined) | null;
  faceOverride?: ArkitFaceWeights | null;
  track?: boolean;
  reducedMotion?: boolean;
  hd?: boolean;
  onFrame?: () => void;
  onLoaded?: () => void;
};

const HEAD_BONE_Y = 1.5; // world height of the head bone (matches the procedural vessel's neck top)
const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

type BoneRest = { bone: THREE.Object3D; rest: THREE.Quaternion };

/** Rotate `bone` by `angle` about a world axis, on top of its rest pose. */
function setWorldRotation(b: BoneRest, turns: [THREE.Vector3, number][], pq: THREE.Quaternion, r: THREE.Quaternion, tmp: THREE.Quaternion) {
  const parent = b.bone.parent;
  if (!parent) return;
  b.bone.quaternion.copy(b.rest);
  parent.getWorldQuaternion(pq);
  r.identity();
  for (const [axis, angle] of turns) r.premultiply(tmp.setFromAxisAngle(axis, angle));
  // local' = parent⁻¹ · R · parent · rest
  b.bone.quaternion.copy(pq).invert().multiply(r).multiply(pq).multiply(b.rest);
}

function useTier(): LifelikeTier & { postprocessing: boolean } {
  return useMemo(() => {
    const q = selectRendererQuality(detectRendererCapabilities());
    return { name: q.name, transmission: q.transmission, postprocessing: q.postprocessing };
  }, []);
}

function CrystalWings({ color, glow, still, tier }: { color: string; glow: number; still: boolean; tier: LifelikeTier }) {
  const group = useRef<THREE.Group>(null);
  const { geo, mat, mats } = useMemo(() => {
    // One elongated six-sided crystal, instanced into two fanned wings.
    const g = new THREE.OctahedronGeometry(1, 0);
    g.scale(0.045, 0.5, 0.012);
    g.translate(0, 0.5, 0);
    const base = new THREE.Color(color);
    const m = new THREE.MeshPhysicalMaterial({
      color: base.clone().lerp(new THREE.Color("#c9d4ff"), 0.45),
      emissive: base,
      emissiveIntensity: 0.35 + glow * 0.5,
      roughness: 0.12,
      metalness: 0,
      ior: 1.5,
      iridescence: 0.7,
      iridescenceIOR: 1.3,
      clearcoat: 1,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      side: THREE.DoubleSide,
      ...(tier.transmission > 0.3 ? { transmission: 0.5, thickness: 0.02 } : {}),
    });
    const ms: THREE.Matrix4[] = [];
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    for (const side of [-1, 1]) {
      const n = 26;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const layer = i % 3;
        const fan = THREE.MathUtils.lerp(0.15, 2.45, t) + (layer - 1) * 0.06; // from up to down-out
        const len = (0.38 + 0.5 * Math.sin(Math.PI * Math.min(1, t * 1.25)) + layer * 0.05) * (1 - 0.15 * t);
        e.set(-0.35 - layer * 0.08, side * (0.55 + layer * 0.06), -side * fan);
        q.setFromEuler(e);
        const s = new THREE.Vector3(1 + layer * 0.15, len, 1);
        const p = new THREE.Vector3(side * (0.07 + t * 0.05), 1.34 - t * 0.12, -0.14 - layer * 0.015);
        ms.push(new THREE.Matrix4().compose(p, q, s));
      }
    }
    return { geo: g, mat: m, mats: ms };
  }, [color, glow, tier.transmission]);
  const mesh = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const im = mesh.current;
    if (!im) return;
    mats.forEach((m, i) => im.setMatrixAt(i, m));
    im.instanceMatrix.needsUpdate = true;
  }, [mats]);
  useEffect(() => () => (geo.dispose(), mat.dispose()), [geo, mat]);
  useFrame(({ clock }) => {
    if (!group.current || still) return;
    group.current.rotation.x = Math.sin(clock.elapsedTime * 0.8) * 0.025;
  });
  return (
    <group ref={group}>
      <instancedMesh ref={mesh} args={[geo, mat, mats.length]} frustumCulled={false} />
    </group>
  );
}

function Halo({ y, color }: { y: number; color: string }) {
  const mat = useMemo(
    () => new THREE.MeshStandardMaterial({ color: "#eef2ff", emissive: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.4), emissiveIntensity: 2.2, roughness: 0.2, toneMapped: false }),
    [color],
  );
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh material={mat} position={[0, y, -0.02]} rotation={[Math.PI / 2 - 0.12, 0, 0]}>
      <torusGeometry args={[0.105, 0.0045, 8, 64]} />
    </mesh>
  );
}

export default function LifelikeVessel({ path, config, expression, speaking = false, audioLevel, faceOverride, track = true, reducedMotion = false, hd = false, onFrame, onLoaded }: Props) {
  const { scene } = useGLTF(path);
  const tier = useTier();
  const shadows = hd && tier.name !== "low";
  const cloned = useMemo(() => cloneSkinned(scene), [scene]);
  const eyeGlow = config.eyes.glow > 0.5 ? config.eyes.color : null;
  useEffect(() => {
    const made = upgradeLifelikeMaterials(cloned, tier, { shadows, eyeGlow });
    return () => made.forEach((m) => m.dispose());
  }, [cloned, tier, shadows, eyeGlow]);
  useEffect(
    () => () => {
      cloned.removeFromParent();
      cloned.clear();
    },
    [cloned],
  );

  // Normalise height so cameras / auras framed for the procedural vessel still fit.
  const { scale, bones } = useMemo(() => {
    cloned.updateMatrixWorld(true);
    const head = cloned.getObjectByName("head");
    const y = head ? head.getWorldPosition(new THREE.Vector3()).y : HEAD_BONE_Y;
    const get = (n: string): BoneRest | null => {
      const b = cloned.getObjectByName(n);
      return b ? { bone: b, rest: b.quaternion.clone() } : null;
    };
    return {
      scale: y > 0.5 ? HEAD_BONE_Y / y : 1,
      bones: {
        head: get("head"),
        neck: get("neck"),
        chest: get("chest"),
        spine: get("spine"),
        lArm: get("leftUpperArm"),
        rArm: get("rightUpperArm"),
        lFore: get("leftLowerArm"),
        rFore: get("rightLowerArm"),
      },
    };
  }, [cloned]);

  useArkitFace(cloned, { expression, speaking, audioLevel, override: faceOverride });

  const { pointer } = useThree();
  const look = useRef({ x: 0, y: 0, tilt: 0 });
  const scratch = useMemo(() => ({ pq: new THREE.Quaternion(), r: new THREE.Quaternion(), t: new THREE.Quaternion() }), []);
  useFrame(({ clock }) => {
    const still = reducedMotion;
    const t = clock.elapsedTime;
    const e = expression;
    const k = still ? 1 : 0.08;
    const L = look.current;
    L.x += ((still ? 0 : track ? pointer.x * 0.4 : Math.sin(t * 0.3) * 0.12) - L.x) * k;
    L.y += ((still ? 0 : track ? pointer.y * 0.18 : 0) - L.y) * k;
    L.tilt += (e.tilt - L.tilt) * (still ? 1 : 0.05);
    const breathe = still ? 0 : Math.sin(t * (1.2 + e.energy * 0.8)) * (0.012 + e.energy * 0.006);
    const { pq, r, t: tmp } = scratch;
    // Parents first: getWorldQuaternion() refreshes the parent chain, so children see the new pose.
    if (bones.spine) setWorldRotation(bones.spine, [[X, breathe * 0.4]], pq, r, tmp);
    if (bones.chest) setWorldRotation(bones.chest, [[X, -breathe * 0.8]], pq, r, tmp);
    if (bones.neck) setWorldRotation(bones.neck, [[Y, L.x * 0.4], [X, -L.y * 0.4]], pq, r, tmp);
    if (bones.head) setWorldRotation(bones.head, [[Y, L.x * 0.6], [X, -L.y * 0.6], [Z, -L.tilt]], pq, r, tmp);
    // Relax the A-pose: arms closer to the body, a soft elbow, breathing with the chest.
    if (bones.lArm) setWorldRotation(bones.lArm, [[Z, -0.38 + breathe * 0.3], [X, 0.06]], pq, r, tmp);
    if (bones.rArm) setWorldRotation(bones.rArm, [[Z, 0.38 - breathe * 0.3], [X, 0.06]], pq, r, tmp);
    if (bones.lFore) setWorldRotation(bones.lFore, [[X, -0.12]], pq, r, tmp);
    if (bones.rFore) setWorldRotation(bones.rFore, [[X, -0.12]], pq, r, tmp);
    onFrame?.();
  });

  const loaded = useRef(onLoaded);
  loaded.current = onLoaded;
  useEffect(() => {
    loaded.current?.();
  }, [cloned]);

  const angelic = config.effects.aura === "wings";
  const halo = config.accessories.includes("halo-ring") || config.effects.aura === "halo";
  return (
    <group scale={config.height}>
      <primitive object={cloned} scale={scale} />
      {angelic && <CrystalWings color={config.effects.color} glow={config.effects.glow} still={reducedMotion} tier={tier} />}
      {halo && <Halo y={HEAD_BONE_Y + 0.33} color={config.eyes.color} />}
    </group>
  );
}
