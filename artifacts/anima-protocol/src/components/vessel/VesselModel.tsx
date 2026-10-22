/**
 * Procedural low-poly vessel (licensing-clean placeholder) with asset slots.
 * Driven by VesselConfig + Expression; animates breathing, head tracking and
 * emotion. `hologram` renders an additive translucent projection (resonance layer).
 */
import { Suspense, useMemo, useRef, Component, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import type { VesselConfig } from "@/lib/vessel/vesselConfig";
import type { Expression } from "@/lib/vessel/emotion";
import { computeVesselShift, type VesselShift } from "@/lib/vessel/emotionShift";
import { NEUTRAL_EMOTION } from "@/lib/vessel/emotionState";
import { traitsFor } from "@/lib/vessel/vesselTraits";
import VesselAura from "./VesselAura";

/** Calm flame shift for a saved `effects.aura: "flame"` vessel when no live emotion drives it. */
function useStaticFlameShift(config: VesselConfig, active: boolean): VesselShift | null {
  const { aura, color, glow } = config.effects;
  return useMemo(() => {
    if (!active || aura !== "flame") return null;
    const s = computeVesselShift(NEUTRAL_EMOTION, traitsFor("scarlet"));
    return { ...s, aura: "flame", color, auraIntensity: Math.max(0.3, glow) };
  }, [active, aura, color, glow]);
}

type Props = {
  config: VesselConfig;
  expression: Expression;
  hd?: boolean;
  hologram?: boolean;
  /** Track the pointer with the head (off for instanced/background vessels). */
  track?: boolean;
  /** Called every animated frame (used by demand-frameloop hosts to request more frames). */
  onFrame?: () => void;
  /** Emotion vessel-shift; overrides the face weights and adds the companion aura. */
  shift?: VesselShift | null;
};

const BODY: Record<string, { w: number; hip: number; h: number }> = {
  slender: { w: 0.2, hip: 0.24, h: 1 },
  athletic: { w: 0.24, hip: 0.25, h: 1 },
  curvy: { w: 0.22, hip: 0.3, h: 0.98 },
  petite: { w: 0.18, hip: 0.22, h: 0.9 },
  tall: { w: 0.21, hip: 0.25, h: 1.08 },
};

function useMat(color: string, hologram: boolean, emissive?: string, emissiveIntensity = 0) {
  return useMemo(() => {
    if (hologram) {
      return new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.35,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
    }
    return new THREE.MeshStandardMaterial({
      color,
      flatShading: true,
      roughness: 0.7,
      metalness: 0.05,
      emissive: emissive ? new THREE.Color(emissive) : new THREE.Color(0),
      emissiveIntensity,
    });
  }, [color, hologram, emissive, emissiveIntensity]);
}

function Hair({ style, mat, seg }: { style: string; mat: THREE.Material; seg: number }) {
  const cap = (
    <mesh material={mat} position={[0, 0.03, -0.01]} scale={[1.06, 1.02, 1.08]}>
      <sphereGeometry args={[0.13, seg, seg, 0, Math.PI * 2, 0, Math.PI * 0.55]} />
    </mesh>
  );
  switch (style) {
    case "pixie":
      return cap;
    case "bob":
      return (
        <group>
          {cap}
          <mesh material={mat} position={[0, -0.04, -0.02]} scale={[1.15, 0.8, 1.1]}>
            <sphereGeometry args={[0.13, seg, seg, 0, Math.PI * 2, Math.PI * 0.35, Math.PI * 0.4]} />
          </mesh>
        </group>
      );
    case "wild":
      return (
        <mesh material={mat} position={[0, 0.02, -0.03]} scale={[1.25, 1.15, 1.25]}>
          <icosahedronGeometry args={[0.14, 1]} />
        </mesh>
      );
    case "bun":
      return (
        <group>
          {cap}
          <mesh material={mat} position={[0, 0.12, -0.08]}>
            <sphereGeometry args={[0.06, seg, seg]} />
          </mesh>
        </group>
      );
    case "ponytail":
      return (
        <group>
          {cap}
          <mesh material={mat} position={[0, -0.08, -0.14]} rotation={[0.35, 0, 0]}>
            <capsuleGeometry args={[0.035, 0.22, 3, seg]} />
          </mesh>
        </group>
      );
    case "braid":
      return (
        <group>
          {cap}
          {[0, 1, 2, 3, 4].map((i) => (
            <mesh key={i} material={mat} position={[0, -0.05 - i * 0.07, -0.13]}>
              <sphereGeometry args={[0.035 - i * 0.003, seg, seg]} />
            </mesh>
          ))}
        </group>
      );
    default: // long
      return (
        <group>
          {cap}
          <mesh material={mat} position={[0, -0.16, -0.07]} scale={[1, 1, 0.55]}>
            <capsuleGeometry args={[0.12, 0.3, 3, seg]} />
          </mesh>
        </group>
      );
  }
}

function Aura({ config, hologram }: { config: VesselConfig; hologram: boolean }) {
  const { aura, color, glow } = config.effects;
  const count = config.effects.particles;
  const points = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.35 + Math.random() * 0.35;
      p[i * 3] = Math.cos(a) * r;
      p[i * 3 + 1] = Math.random() * 1.9;
      p[i * 3 + 2] = Math.sin(a) * r;
    }
    g.setAttribute("position", new THREE.BufferAttribute(p, 3));
    return g;
  }, [count]);
  useFrame((_, dt) => {
    if (points.current) points.current.rotation.y += dt * (aura === "glitch" ? 1.5 : 0.25);
  });
  const emissive = useMemo(
    () => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.25 + glow * 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    [color, glow],
  );
  return (
    <group>
      {count > 0 && aura !== "none" && (
        <points ref={points} geometry={geo}>
          <pointsMaterial color={color} size={aura === "mist" ? 0.06 : 0.025} transparent opacity={0.4 + glow * 0.4} depthWrite={false} blending={THREE.AdditiveBlending} sizeAttenuation />
        </points>
      )}
      {aura === "halo" && (
        <mesh material={emissive} position={[0, 1.86, -0.06]} rotation={[Math.PI / 2.3, 0, 0]}>
          <torusGeometry args={[0.14, 0.008, 6, 32]} />
        </mesh>
      )}
      {aura === "wings" && !hologram &&
        [-1, 1].map((s) => (
          <mesh key={s} material={emissive} position={[s * 0.32, 1.3, -0.15]} rotation={[0, s * 0.5, s * 0.35]}>
            <planeGeometry args={[0.55, 0.8]} />
          </mesh>
        ))}
    </group>
  );
}

function ProceduralVessel({ config, expression: exprProp, hd = false, hologram = false, track = true, onFrame, shift = null }: Props) {
  const expression = shift ? shift.face : exprProp;
  const flameShift = useStaticFlameShift(config, !shift && !hologram);
  const seg = hd ? 20 : 8;
  const b = BODY[config.bodyType] || BODY.slender;
  const torso = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const mouth = useRef<THREE.Mesh>(null);
  const browL = useRef<THREE.Mesh>(null);
  const browR = useRef<THREE.Mesh>(null);
  const eyes = useRef<THREE.Group>(null);
  const root = useRef<THREE.Group>(null);
  const { pointer } = useThree();

  const skin = useMat(config.skinTone, hologram);
  const hair = useMat(config.hair.color, hologram);
  const cloth = useMat(config.outfit.color, hologram);
  const accent = useMat(config.outfit.accent, hologram, config.outfit.accent, 0.25);
  const eye = useMat(config.eyes.color, hologram, config.eyes.color, 0.4 + config.eyes.glow * 2);
  const dark = useMat("#1f1a1a", hologram);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const e = expression;
    const breathe = Math.sin(t * (1.2 + e.energy * 0.8)) * (0.012 + e.energy * 0.006);
    if (torso.current) torso.current.scale.set(1 + breathe * 0.6, 1 + breathe, 1 + breathe);
    if (head.current) {
      const tx = track ? pointer.x * 0.45 : Math.sin(t * 0.3) * 0.15;
      const ty = track ? -pointer.y * 0.25 : 0;
      head.current.rotation.y += (tx - head.current.rotation.y) * 0.08;
      head.current.rotation.x += (ty - head.current.rotation.x) * 0.08;
      head.current.rotation.z += (e.tilt - head.current.rotation.z) * 0.05;
      head.current.position.y = 1.58 + breathe * 0.5;
    }
    if (mouth.current) {
      mouth.current.rotation.z = e.smile >= 0 ? Math.PI : 0;
      mouth.current.scale.y += (0.4 + Math.abs(e.smile) * 0.8 - mouth.current.scale.y) * 0.1;
      mouth.current.position.y = e.smile >= 0 ? -0.045 : -0.06;
    }
    const browY = 0.055 + e.brow * 0.012;
    if (browL.current && browR.current) {
      browL.current.position.y = browY;
      browR.current.position.y = browY;
      browL.current.rotation.z = -e.brow * 0.25;
      browR.current.rotation.z = e.brow * 0.25;
    }
    if (eyes.current) {
      const blink = Math.sin(t * 0.9) > 0.985 ? 0.1 : 1;
      eyes.current.scale.y = Math.max(0.1, e.eyeOpen * blink);
    }
    if (root.current && config.effects.aura === "glitch") {
      root.current.position.x = Math.random() < 0.04 ? (Math.random() - 0.5) * 0.04 : 0;
    }
    onFrame?.();
  });

  const skirt = config.outfit.bottom === "gown" || config.outfit.bottom === "skirt";
  const has = (a: string) => config.accessories.includes(a);

  return (
    <group ref={root} scale={config.height * b.h}>
      {/* legs / lower outfit */}
      {skirt ? (
        <mesh material={cloth} position={[0, config.outfit.bottom === "gown" ? 0.45 : 0.72, 0]}>
          <coneGeometry args={[b.hip * (config.outfit.bottom === "gown" ? 1.5 : 1.25), config.outfit.bottom === "gown" ? 0.9 : 0.38, seg, 1, true]} />
        </mesh>
      ) : null}
      {[-1, 1].map((s) => (
        <mesh key={s} material={config.outfit.bottom === "trousers" ? cloth : skin} position={[s * b.hip * 0.45, 0.42, 0]}>
          <capsuleGeometry args={[0.05, 0.7, 2, seg]} />
        </mesh>
      ))}
      {/* torso */}
      <group ref={torso} position={[0, 1.12, 0]}>
        <mesh material={cloth} scale={[1, 1, 0.7]}>
          <capsuleGeometry args={[b.w, 0.32, 3, seg]} />
        </mesh>
        <mesh material={accent} position={[0, -0.2, 0]} scale={[1, 0.15, 0.72]}>
          <cylinderGeometry args={[b.w * 1.02, b.w * 1.02, 0.2, seg]} />
        </mesh>
        {[-1, 1].map((s) => (
          <mesh key={s} material={config.outfit.top === "bodysuit" ? cloth : skin} position={[s * (b.w + 0.06), -0.05, 0]} rotation={[0, 0, s * 0.12]}>
            <capsuleGeometry args={[0.04, 0.5, 2, seg]} />
          </mesh>
        ))}
        {has("shoulder-plates") &&
          [-1, 1].map((s) => (
            <mesh key={s} material={accent} position={[s * (b.w + 0.04), 0.2, 0]}>
              <boxGeometry args={[0.12, 0.05, 0.14]} />
            </mesh>
          ))}
        {has("scarf") && (
          <mesh material={accent} position={[0, 0.3, 0]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.09, 0.03, 6, seg * 2]} />
          </mesh>
        )}
      </group>
      {/* neck */}
      <mesh material={skin} position={[0, 1.45, 0]}>
        <cylinderGeometry args={[0.04, 0.045, 0.1, seg]} />
      </mesh>
      {has("choker") && (
        <mesh material={accent} position={[0, 1.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <torusGeometry args={[0.045, 0.008, 4, seg * 2]} />
        </mesh>
      )}
      {/* head */}
      <group ref={head} position={[0, 1.58, 0]}>
        <mesh material={skin} scale={[0.9, 1.05, 0.95]}>
          <sphereGeometry args={[0.12, seg + 4, seg + 4]} />
        </mesh>
        <group ref={eyes} position={[0, 0.015, 0.105]}>
          {[-1, 1].map((s) => (
            <mesh key={s} material={eye} position={[s * 0.04, 0, 0]}>
              <sphereGeometry args={[0.016, seg, seg]} />
            </mesh>
          ))}
        </group>
        <mesh ref={browL} material={hair} position={[-0.04, 0.055, 0.11]}>
          <boxGeometry args={[0.04, 0.007, 0.006]} />
        </mesh>
        <mesh ref={browR} material={hair} position={[0.04, 0.055, 0.11]}>
          <boxGeometry args={[0.04, 0.007, 0.006]} />
        </mesh>
        <mesh ref={mouth} material={dark} position={[0, -0.045, 0.108]}>
          <torusGeometry args={[0.022, 0.004, 4, 12, Math.PI]} />
        </mesh>
        <Hair style={config.hair.style} mat={hair} seg={seg} />
        {has("circlet") && (
          <mesh material={accent} position={[0, 0.06, 0]} rotation={[Math.PI / 2 - 0.15, 0, 0]}>
            <torusGeometry args={[0.125, 0.006, 4, seg * 3]} />
          </mesh>
        )}
        {has("halo-ring") && (
          <mesh material={eye} position={[0, 0.2, -0.02]} rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.1, 0.006, 4, seg * 3]} />
          </mesh>
        )}
        {has("visor") && (
          <mesh material={eye} position={[0, 0.015, 0.11]}>
            <boxGeometry args={[0.18, 0.035, 0.01]} />
          </mesh>
        )}
        {has("earrings") &&
          [-1, 1].map((s) => (
            <mesh key={s} material={accent} position={[s * 0.11, -0.04, 0]}>
              <sphereGeometry args={[0.01, 6, 6]} />
            </mesh>
          ))}
      </group>
      <Aura config={config} hologram={hologram} />
      {(shift || flameShift) && !hologram && <VesselAura shift={(shift || flameShift)!} budget={hd ? 72 : track ? 40 : 0} />}
    </group>
  );
}

function GltfVessel({ url }: { url: string }) {
  // Asset slot for licensed glTF/VRM models. VRM humanoid/expressions need
  // @pixiv/three-vrm (TODO); for now VRM files render as static glTF.
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return <primitive object={cloned} />;
}

class AssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

export default function VesselModel(props: Props) {
  const procedural = <ProceduralVessel {...props} />;
  const { kind, url } = props.config.model;
  if (kind === "procedural" || !url) return procedural;
  return (
    <AssetBoundary fallback={procedural}>
      <Suspense fallback={procedural}>
        <GltfVessel url={url} />
      </Suspense>
    </AssetBoundary>
  );
}
