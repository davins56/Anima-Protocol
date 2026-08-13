import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";
import useFaceTexture from "@/hooks/useFaceTexture";
import TesseractLattice from "@/components/battle/TesseractLattice";
import { wPhaseScale } from "@/lib/tesseract4d";

/**
 * Crystal / glass material helper.
 * HD path uses MeshTransmissionMaterial for true refraction;
 * standard path uses emissive physical for performance.
 */
function CrystalMaterial({
  color,
  emissiveIntensity = 0.55,
  roughness = 0.12,
  metalness = 0.08,
  transmission = 0,
  thickness = 0.4,
  hd = false,
  opacity = 1,
  ...rest
}) {
  if (hd && transmission > 0.05) {
    return (
      <MeshTransmissionMaterial
        backside
        samples={hd ? 6 : 4}
        resolution={hd ? 256 : 128}
        thickness={thickness}
        chromaticAberration={0.05}
        anisotropy={0.2}
        distortion={0.1}
        distortionScale={0.15}
        temporalDistortion={0.06}
        color={color}
        emissive={color}
        emissiveIntensity={emissiveIntensity * 0.6}
        roughness={roughness}
        metalness={metalness}
        ior={1.42}
        transparent
        opacity={opacity}
        toneMapped={false}
        {...rest}
      />
    );
  }
  return (
    <meshPhysicalMaterial
      color={color}
      emissive={color}
      emissiveIntensity={emissiveIntensity}
      roughness={roughness}
      metalness={metalness}
      transparent={opacity < 0.99 || transmission > 0}
      opacity={opacity}
      transmission={transmission}
      thickness={thickness}
      side={THREE.DoubleSide}
      toneMapped={false}
      {...rest}
    />
  );
}

function Emissive({ color, emissiveIntensity = 0.9, roughness = 0.2, metalness = 0.25, ...rest }) {
  return (
    <meshStandardMaterial
      color={color}
      emissive={color}
      emissiveIntensity={emissiveIntensity}
      roughness={roughness}
      metalness={metalness}
      toneMapped={false}
      {...rest}
    />
  );
}

/** Faceted crystalline wing built from multiple diamond-like meshes. */
function CrystalWing({
  side = 1,
  color,
  accent,
  hd,
  flapAmount = 0,
}) {
  const group = useRef(null);
  const facets = useMemo(() => {
    // Generate a spread of facet positions that form a large angelic wing silhouette
    const list = [];
    const layers = hd ? 5 : 3;
    for (let layer = 0; layer < layers; layer++) {
      const yBase = 0.55 + layer * 0.18;
      const count = 3 + layer;
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        const spread = 0.35 + layer * 0.22;
        const x = (0.15 + t * spread) * side;
        const y = yBase + Math.sin(t * Math.PI) * 0.12 - layer * 0.04;
        const z = -0.08 - layer * 0.04 + (t - 0.5) * 0.06;
        const scale = 0.22 - layer * 0.025 + (1 - Math.abs(t - 0.5)) * 0.06;
        const rotY = side * (0.35 + t * 0.55 + layer * 0.08);
        const rotZ = side * (0.15 + t * 0.2);
        const rotX = -0.25 + t * 0.15 - layer * 0.05;
        list.push({ x, y, z, scale, rotX, rotY, rotZ, key: `${layer}-${i}` });
      }
    }
    // Primary large primary feather
    list.push({
      x: side * 0.55,
      y: 0.72,
      z: -0.12,
      scale: 0.38,
      rotX: -0.3,
      rotY: side * 0.75,
      rotZ: side * 0.25,
      key: "primary",
    });
    return list;
  }, [side, hd]);

  useFrame(() => {
    if (group.current) {
      group.current.rotation.y = side * (0.15 + flapAmount * 0.55);
      group.current.rotation.z = side * (0.08 + flapAmount * 0.12);
    }
  });

  return (
    <group ref={group} position={[side * 0.12, 0.15, -0.02]}>
      {facets.map((f) => (
        <mesh
          key={f.key}
          position={[f.x, f.y, f.z]}
          rotation={[f.rotX, f.rotY, f.rotZ]}
          scale={[f.scale * (side < 0 ? -1 : 1), f.scale * 1.35, f.scale * 0.35]}
        >
          <octahedronGeometry args={[1, hd ? 0 : 0]} />
          <CrystalMaterial
            color={color}
            hd={hd}
            transmission={hd ? 0.72 : 0.25}
            thickness={0.55}
            emissiveIntensity={0.65}
            roughness={0.08}
            opacity={0.78}
          />
        </mesh>
      ))}
      {/* Soft glow membrane behind facets */}
      <mesh
        position={[side * 0.28, 0.7, -0.05]}
        rotation={[0.15, side * 0.7, side * 0.1]}
        scale={[side * 0.55, 0.75, 0.08]}
      >
        <planeGeometry args={[1, 1]} />
        <meshPhysicalMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.45}
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function VesselWings({ color, accent, hd }) {
  const flap = useRef(0);
  useFrame((state) => {
    flap.current = 0.55 + Math.sin(state.clock.elapsedTime * 1.85) * 0.38;
  });
  return (
    <group>
      <CrystalWing side={-1} color={color} accent={accent} hd={hd} flapAmount={flap.current} />
      <CrystalWing side={1} color={color} accent={accent} hd={hd} flapAmount={flap.current} />
    </group>
  );
}

/** Voluminous curly hair approximation (white / luminous). */
function HairVolume({ color = "#f8fafc", hd }) {
  const segs = hd ? 16 : 10;
  const curls = useMemo(() => {
    const list = [];
    for (let i = 0; i < (hd ? 18 : 11); i++) {
      const a = (i / 18) * Math.PI * 2;
      const r = 0.16 + (i % 3) * 0.035;
      list.push({
        x: Math.cos(a) * r,
        y: 1.12 + Math.sin(a * 2.3) * 0.06 + (i % 4) * 0.04,
        z: Math.sin(a) * r * 0.85 - 0.02,
        sx: 0.07 + (i % 3) * 0.02,
        sy: 0.11 + (i % 2) * 0.04,
        sz: 0.07 + (i % 3) * 0.02,
        key: i,
      });
    }
    // Top crown volume
    list.push({ x: 0, y: 1.28, z: 0, sx: 0.2, sy: 0.14, sz: 0.18, key: "crown" });
    return list;
  }, [hd]);

  return (
    <group>
      {curls.map((c) => (
        <mesh key={c.key} position={[c.x, c.y, c.z]} scale={[c.sx, c.sy, c.sz]}>
          <sphereGeometry args={[1, segs, segs]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.35}
            roughness={0.55}
            metalness={0.05}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Full-body coherent Anima vessel.
 * Anatomically proportioned humanoid with crystalline wings, hair volume,
 * fabric drape, and 4D lattice. Props API unchanged for drop-in replacement.
 */
export default function AnimaVesselMesh({
  model,
  hd = false,
  flinch = 0,
  hpRatio = 1,
  facing = 1,
  showLattice = false,
}) {
  const root = useRef(null);
  const halo = useRef(null);
  const core = useRef(null);
  const color = model?.color || "#67e8f9";
  const accent = model?.accent || "#c4b5fd"; // soft violet to match reference
  const gold = model?.gold || "#fde68a";
  const faceMap = useFaceTexture(model?.texture_url);
  const dim = 0.55 + Math.max(0, Math.min(1, hpRatio)) * 0.45;
  const headSeg = hd ? 48 : 24;
  const bodySeg = hd ? 24 : 14;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const phase = wPhaseScale({ xw: t * 0.42, yw: t * 0.26, zw: t * 0.17 });
    const wPulse = 1 + (phase - 0.85) * 0.07;

    if (root.current) {
      root.current.position.y = Math.sin(t * 1.35) * 0.035;
      root.current.rotation.y = (facing > 0 ? 0 : Math.PI) + Math.sin(t * 0.28) * 0.03;
      root.current.scale.setScalar(dim * wPulse);
      const hit = flinch > 0 ? Math.sin(t * 42) * 0.04 : 0;
      root.current.position.x = hit;
    }
    if (halo.current) {
      halo.current.rotation.z = t * 0.48;
      halo.current.rotation.x = 1.05 + Math.sin(t * 1.1) * 0.05;
    }
    if (core.current) {
      core.current.rotation.x = t * 0.35;
      core.current.rotation.y = t * 0.55;
    }
  });

  return (
    <group ref={root}>
      <pointLight color={color} intensity={hd ? 2.4 : 1.25} distance={hd ? 7 : 3.5} position={[0, 0.9, 0.4]} />
      <pointLight color={accent} intensity={hd ? 1.1 : 0.45} distance={4.5} position={[0.5, 1.3, 0.6]} />
      <pointLight color={gold} intensity={0.35} distance={3} position={[-0.4, 1.1, 0.3]} />

      {/* ===== HEAD ===== */}
      <mesh position={[0, 1.38, 0]}>
        <sphereGeometry args={[0.165, headSeg, Math.max(14, Math.floor(headSeg * 0.75))]} />
        <CrystalMaterial
          color="#1c1917"
          hd={false}
          emissiveIntensity={0.08}
          roughness={0.45}
          metalness={0.1}
        />
      </mesh>

      {/* Face plane (portrait) */}
      {faceMap && (
        <mesh position={[0, 1.38, 0.145]}>
          <circleGeometry args={[0.115, hd ? 48 : 24]} />
          <meshBasicMaterial map={faceMap} toneMapped={false} />
        </mesh>
      )}

      {/* Eyes glow (fallback when no face texture) */}
      {!faceMap && (
        <>
          <mesh position={[-0.045, 1.4, 0.14]}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <Emissive color={color} emissiveIntensity={2.2} />
          </mesh>
          <mesh position={[0.045, 1.4, 0.14]}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <Emissive color={color} emissiveIntensity={2.2} />
          </mesh>
        </>
      )}

      <HairVolume color="#f1f5f9" hd={hd} />

      {/* Halo */}
      <mesh ref={halo} position={[0, 1.62, -0.02]}>
        <torusGeometry args={[0.2, hd ? 0.014 : 0.016, hd ? 16 : 10, hd ? 64 : 32]} />
        <Emissive color={gold} emissiveIntensity={1.6} metalness={0.6} />
      </mesh>

      {/* Neck */}
      <mesh position={[0, 1.2, 0]}>
        <capsuleGeometry args={[0.055, 0.08, 6, bodySeg]} />
        <CrystalMaterial color="#292524" hd={false} emissiveIntensity={0.05} roughness={0.5} />
      </mesh>

      {/* ===== TORSO ===== */}
      {/* Shoulders / upper chest */}
      <mesh position={[0, 1.05, 0]} scale={[1.15, 0.7, 0.75]}>
        <sphereGeometry args={[0.2, bodySeg, bodySeg]} />
        <CrystalMaterial
          color={color}
          hd={hd}
          transmission={hd ? 0.35 : 0.08}
          thickness={0.5}
          emissiveIntensity={0.35}
          roughness={0.18}
          opacity={0.92}
        />
      </mesh>

      {/* Bust / mid torso */}
      <mesh position={[0, 0.88, 0.02]} scale={[1.05, 0.85, 0.8]}>
        <sphereGeometry args={[0.18, bodySeg, bodySeg]} />
        <CrystalMaterial
          color={color}
          hd={hd}
          transmission={hd ? 0.4 : 0.1}
          thickness={0.55}
          emissiveIntensity={0.3}
          roughness={0.16}
          opacity={0.9}
        />
      </mesh>

      {/* Waist */}
      <mesh position={[0, 0.68, 0]} scale={[0.85, 0.7, 0.7]}>
        <capsuleGeometry args={[0.14, 0.12, 8, bodySeg]} />
        <CrystalMaterial
          color={color}
          hd={hd}
          transmission={hd ? 0.45 : 0.12}
          thickness={0.6}
          emissiveIntensity={0.28}
          roughness={0.15}
        />
      </mesh>

      {/* Hips */}
      <mesh position={[0, 0.48, 0]} scale={[1.1, 0.65, 0.8]}>
        <sphereGeometry args={[0.17, bodySeg, bodySeg]} />
        <CrystalMaterial
          color={color}
          hd={hd}
          transmission={hd ? 0.35 : 0.08}
          thickness={0.5}
          emissiveIntensity={0.25}
          roughness={0.2}
        />
      </mesh>

      {/* Inner core (resonance) */}
      <mesh ref={core} position={[0, 0.82, 0]} scale={0.13}>
        <icosahedronGeometry args={[1, hd ? 1 : 0]} />
        <Emissive color={accent} emissiveIntensity={1.8} metalness={0.45} />
      </mesh>

      {/* ===== ARMS ===== */}
      {[-1, 1].map((side) => (
        <group key={`arm-${side}`} position={[side * 0.22, 1.02, 0]}>
          {/* Upper arm */}
          <mesh position={[side * 0.06, -0.12, 0]} rotation={[0.15, 0, side * 0.35]}>
            <capsuleGeometry args={[0.045, 0.22, 6, hd ? 12 : 8]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.15} emissiveIntensity={0.3} />
          </mesh>
          {/* Forearm */}
          <mesh position={[side * 0.12, -0.38, 0.02]} rotation={[0.35, 0, side * 0.15]}>
            <capsuleGeometry args={[0.038, 0.2, 6, hd ? 12 : 8]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.15} emissiveIntensity={0.28} />
          </mesh>
          {/* Hand */}
          <mesh position={[side * 0.14, -0.55, 0.04]}>
            <sphereGeometry args={[0.04, 10, 10]} />
            <CrystalMaterial color={color} hd={false} emissiveIntensity={0.25} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {/* ===== LEGS ===== */}
      {[-1, 1].map((side) => (
        <group key={`leg-${side}`} position={[side * 0.09, 0.35, 0]}>
          {/* Thigh */}
          <mesh position={[0, -0.18, 0]} rotation={[0.05, 0, side * 0.04]}>
            <capsuleGeometry args={[0.065, 0.28, 6, bodySeg]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.12} emissiveIntensity={0.22} />
          </mesh>
          {/* Calf */}
          <mesh position={[0, -0.48, 0.01]} rotation={[-0.08, 0, 0]}>
            <capsuleGeometry args={[0.05, 0.26, 6, bodySeg]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.12} emissiveIntensity={0.2} />
          </mesh>
          {/* Foot */}
          <mesh position={[0, -0.68, 0.04]} scale={[1, 0.45, 1.5]}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <CrystalMaterial color={color} hd={false} emissiveIntensity={0.18} roughness={0.35} />
          </mesh>
        </group>
      ))}

      {/* ===== FABRIC DRAPE (translucent white/violet) ===== */}
      <mesh position={[0, 0.55, 0.08]} rotation={[-0.15, 0, 0]} scale={[0.55, 0.7, 0.12]}>
        <planeGeometry args={[1, 1.2]} />
        <meshPhysicalMaterial
          color="#e0e7ff"
          emissive={accent}
          emissiveIntensity={0.15}
          transparent
          opacity={0.28}
          side={THREE.DoubleSide}
          roughness={0.4}
          transmission={hd ? 0.4 : 0}
          thickness={0.2}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0.08, 0.4, 0.1]} rotation={[-0.25, 0.2, 0.15]} scale={[0.35, 0.55, 0.08]}>
        <planeGeometry args={[1, 1]} />
        <meshPhysicalMaterial
          color="#f5f3ff"
          emissive={accent}
          emissiveIntensity={0.12}
          transparent
          opacity={0.22}
          side={THREE.DoubleSide}
          roughness={0.45}
          toneMapped={false}
        />
      </mesh>

      {/* Gold accent bands */}
      <mesh position={[0, 0.95, 0.12]} rotation={[0.1, 0, 0]}>
        <torusGeometry args={[0.17, 0.008, 8, 32]} />
        <Emissive color={gold} emissiveIntensity={1.1} metalness={0.7} />
      </mesh>

      {/* ===== CRYSTALLINE WINGS ===== */}
      <VesselWings color={color} accent={accent} hd={hd} />

      {/* ===== 4D LATTICE ===== */}
      {(hd || showLattice) && (
        <TesseractLattice
          color={accent}
          scale={hd ? 1.25 : 1.05}
          speed={0.8}
          opacity={hd ? 0.5 : 0.35}
          position={[0, 0.85, 0]}
        />
      )}
    </group>
  );
}
