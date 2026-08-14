import { useRef, useMemo, Suspense } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial, useGLTF } from "@react-three/drei";
import * as THREE from "three";
import useFaceTexture from "@/hooks/useFaceTexture";
import TesseractLattice from "@/components/battle/TesseractLattice";
import { wPhaseScale } from "@/lib/tesseract4d";
import { RENDERER_QUALITY } from "@/lib/rendererQuality";

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

/** Faceted crystalline wing — density scales with quality.vesselFacets. */
function CrystalWing({ side = 1, color, accent, hd, layers = 4, flapAmount = 0, expression = 0 }) {
  const group = useRef(null);
  const facets = useMemo(() => {
    const list = [];
    for (let layer = 0; layer < layers; layer++) {
      const yBase = 0.5 + layer * 0.16;
      const count = 3 + layer;
      for (let i = 0; i < count; i++) {
        const t = i / Math.max(1, count - 1);
        const spread = 0.32 + layer * 0.2;
        list.push({
          x: (0.12 + t * spread) * side,
          y: yBase + Math.sin(t * Math.PI) * 0.11 - layer * 0.03,
          z: -0.06 - layer * 0.035 + (t - 0.5) * 0.05,
          scale: 0.2 - layer * 0.022 + (1 - Math.abs(t - 0.5)) * 0.055,
          rotX: -0.22 + t * 0.12 - layer * 0.04,
          rotY: side * (0.32 + t * 0.5 + layer * 0.07),
          rotZ: side * (0.12 + t * 0.18),
          key: `${layer}-${i}`,
        });
      }
    }
    list.push({
      x: side * 0.52,
      y: 0.7,
      z: -0.1,
      scale: 0.36,
      rotX: -0.28,
      rotY: side * 0.72,
      rotZ: side * 0.22,
      key: "primary",
    });
    return list;
  }, [side, layers]);

  useFrame(() => {
    if (group.current) {
      const open = 0.12 + flapAmount * 0.5 + expression * 0.18;
      group.current.rotation.y = side * open;
      group.current.rotation.z = side * (0.06 + flapAmount * 0.1 + expression * 0.05);
    }
  });

  return (
    <group ref={group} position={[side * 0.11, 0.12, -0.02]}>
      {facets.map((f) => (
        <mesh
          key={f.key}
          position={[f.x, f.y, f.z]}
          rotation={[f.rotX, f.rotY, f.rotZ]}
          scale={[f.scale * (side < 0 ? -1 : 1), f.scale * 1.32, f.scale * 0.32]}
        >
          <octahedronGeometry args={[1, 0]} />
          <CrystalMaterial
            color={color}
            hd={hd}
            transmission={hd ? 0.7 : 0.2}
            thickness={0.5}
            emissiveIntensity={0.6 + expression * 0.35}
            roughness={0.08}
            opacity={0.76}
          />
        </mesh>
      ))}
      <mesh
        position={[side * 0.26, 0.68, -0.04]}
        rotation={[0.12, side * 0.65, side * 0.08]}
        scale={[side * 0.52, 0.72, 0.07]}
      >
        <planeGeometry args={[1, 1]} />
        <meshPhysicalMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.4 + expression * 0.25}
          transparent
          opacity={0.2}
          side={THREE.DoubleSide}
          roughness={0.3}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function VesselWings({ color, accent, hd, layers, expression }) {
  const flap = useRef(0);
  useFrame((state) => {
    flap.current = 0.5 + Math.sin(state.clock.elapsedTime * 1.8) * 0.36;
  });
  return (
    <group>
      <CrystalWing
        side={-1}
        color={color}
        accent={accent}
        hd={hd}
        layers={layers}
        flapAmount={flap.current}
        expression={expression}
      />
      <CrystalWing
        side={1}
        color={color}
        accent={accent}
        hd={hd}
        layers={layers}
        flapAmount={flap.current}
        expression={expression}
      />
    </group>
  );
}

function HairVolume({ color = "#f8fafc", count = 12 }) {
  const segs = count > 14 ? 14 : 10;
  const curls = useMemo(() => {
    const list = [];
    for (let i = 0; i < count; i++) {
      const a = (i / Math.max(1, count)) * Math.PI * 2;
      const r = 0.15 + (i % 3) * 0.032;
      list.push({
        x: Math.cos(a) * r,
        y: 1.1 + Math.sin(a * 2.2) * 0.055 + (i % 4) * 0.035,
        z: Math.sin(a) * r * 0.82 - 0.02,
        sx: 0.065 + (i % 3) * 0.018,
        sy: 0.1 + (i % 2) * 0.035,
        sz: 0.065 + (i % 3) * 0.018,
        key: i,
      });
    }
    list.push({ x: 0, y: 1.26, z: 0, sx: 0.19, sy: 0.13, sz: 0.17, key: "crown" });
    return list;
  }, [count]);

  return (
    <group>
      {curls.map((c) => (
        <mesh key={c.key} position={[c.x, c.y, c.z]} scale={[c.sx, c.sy, c.sz]}>
          <sphereGeometry args={[1, segs, segs]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.32}
            roughness={0.55}
            metalness={0.05}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Optional external GLTF body — falls back silently if missing. */
function GltfBody({ url, color, hd }) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => {
    const root = scene.clone(true);
    root.traverse((obj) => {
      if (obj.isMesh) {
        obj.castShadow = false;
        obj.receiveShadow = false;
        if (obj.material) {
          const m = obj.material.clone();
          if (m.color) m.color.set(color);
          if (m.emissive) m.emissive.set(color);
          m.emissiveIntensity = 0.25;
          m.roughness = 0.25;
          m.metalness = 0.1;
          if (hd && "transmission" in m) {
            m.transmission = 0.25;
            m.thickness = 0.4;
          }
          obj.material = m;
        }
      }
    });
    return root;
  }, [scene, color, hd]);
  return <primitive object={cloned} scale={1} position={[0, 0, 0]} />;
}

function ProceduralBody({
  color,
  accent,
  gold,
  hd,
  faceMap,
  bodySeg,
  headSeg,
  expression,
  breathScale,
  hairCount,
  wingLayers,
  showLattice,
}) {
  const core = useRef(null);
  const torso = useRef(null);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (core.current) {
      core.current.rotation.x = t * 0.35;
      core.current.rotation.y = t * 0.55;
    }
    if (torso.current && breathScale) {
      const b = 1 + Math.sin(t * 1.4) * 0.018 * breathScale;
      torso.current.scale.set(b, 1 + Math.sin(t * 1.4) * 0.012 * breathScale, b);
    }
  });

  return (
    <>
      <mesh position={[0, 1.38, 0]}>
        <sphereGeometry args={[0.165, headSeg, Math.max(14, Math.floor(headSeg * 0.75))]} />
        <CrystalMaterial color="#1c1917" hd={false} emissiveIntensity={0.08} roughness={0.45} />
      </mesh>

      {faceMap && (
        <mesh position={[0, 1.38, 0.145]}>
          <circleGeometry args={[0.115, hd ? 48 : 24]} />
          <meshBasicMaterial map={faceMap} toneMapped={false} />
        </mesh>
      )}

      {!faceMap && (
        <>
          <mesh position={[-0.045, 1.4, 0.14]}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <Emissive color={color} emissiveIntensity={1.8 + expression * 0.8} />
          </mesh>
          <mesh position={[0.045, 1.4, 0.14]}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <Emissive color={color} emissiveIntensity={1.8 + expression * 0.8} />
          </mesh>
        </>
      )}

      <HairVolume color="#f1f5f9" count={hairCount} />

      <mesh position={[0, 1.2, 0]}>
        <capsuleGeometry args={[0.055, 0.08, 6, bodySeg]} />
        <CrystalMaterial color="#292524" hd={false} emissiveIntensity={0.05} roughness={0.5} />
      </mesh>

      <group ref={torso}>
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
      </group>

      <mesh ref={core} position={[0, 0.82, 0]} scale={0.13}>
        <icosahedronGeometry args={[1, hd ? 1 : 0]} />
        <Emissive color={accent} emissiveIntensity={1.6 + expression * 0.6} metalness={0.45} />
      </mesh>

      {[-1, 1].map((side) => (
        <group key={`arm-${side}`} position={[side * 0.22, 1.02, 0]}>
          <mesh position={[side * 0.06, -0.12, 0]} rotation={[0.15, 0, side * 0.35]}>
            <capsuleGeometry args={[0.045, 0.22, 6, hd ? 12 : 8]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.15} emissiveIntensity={0.3} />
          </mesh>
          <mesh position={[side * 0.12, -0.38, 0.02]} rotation={[0.35, 0, side * 0.15]}>
            <capsuleGeometry args={[0.038, 0.2, 6, hd ? 12 : 8]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.15} emissiveIntensity={0.28} />
          </mesh>
          <mesh position={[side * 0.14, -0.55, 0.04]}>
            <sphereGeometry args={[0.04, 10, 10]} />
            <CrystalMaterial color={color} hd={false} emissiveIntensity={0.25} roughness={0.3} />
          </mesh>
        </group>
      ))}

      {[-1, 1].map((side) => (
        <group key={`leg-${side}`} position={[side * 0.09, 0.35, 0]}>
          <mesh position={[0, -0.18, 0]} rotation={[0.05, 0, side * 0.04]}>
            <capsuleGeometry args={[0.065, 0.28, 6, bodySeg]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.12} emissiveIntensity={0.22} />
          </mesh>
          <mesh position={[0, -0.48, 0.01]} rotation={[-0.08, 0, 0]}>
            <capsuleGeometry args={[0.05, 0.26, 6, bodySeg]} />
            <CrystalMaterial color={color} hd={hd} transmission={0.12} emissiveIntensity={0.2} />
          </mesh>
          <mesh position={[0, -0.68, 0.04]} scale={[1, 0.45, 1.5]}>
            <sphereGeometry args={[0.055, 10, 10]} />
            <CrystalMaterial color={color} hd={false} emissiveIntensity={0.18} roughness={0.35} />
          </mesh>
        </group>
      ))}

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

      <mesh position={[0, 0.95, 0.12]} rotation={[0.1, 0, 0]}>
        <torusGeometry args={[0.17, 0.008, 8, 32]} />
        <Emissive color={gold} emissiveIntensity={1.1} metalness={0.7} />
      </mesh>

      <VesselWings
        color={color}
        accent={accent}
        hd={hd}
        layers={wingLayers}
        expression={expression}
      />

      {showLattice && (
        <TesseractLattice
          color={accent}
          scale={hd ? 1.25 : 1.05}
          speed={0.8}
          opacity={hd ? 0.5 : 0.35}
          position={[0, 0.85, 0]}
        />
      )}
    </>
  );
}

/**
 * Full-body coherent Anima vessel (Sovereign Presence).
 * Supports quality tiers, optional GLTF body, breathing, expression intensity.
 */
export default function AnimaVesselMesh({
  model,
  hd: hdProp,
  quality: qualityProp,
  flinch = 0,
  hpRatio = 1,
  facing = 1,
  showLattice = false,
  gltfUrl,
  expression = 0,
  breathing = true,
}) {
  const root = useRef(null);
  const halo = useRef(null);

  const quality =
    qualityProp && typeof qualityProp === "object"
      ? qualityProp
      : hdProp
        ? RENDERER_QUALITY.high
        : RENDERER_QUALITY.medium;

  const hd = quality.vesselHd ?? Boolean(hdProp);
  const wingLayers = quality.vesselFacets ?? (hd ? 5 : 3);
  const hairCount = quality.vesselHair ?? (hd ? 16 : 10);
  const breathOn = breathing && (quality.vesselBreath !== false);

  const color = model?.color || "#67e8f9";
  const accent = model?.accent || "#c4b5fd";
  const gold = model?.gold || "#fde68a";
  const faceMap = useFaceTexture(model?.texture_url);
  const resolvedGltf = gltfUrl || model?.gltf_url || model?.body_url || null;
  const dim = 0.55 + Math.max(0, Math.min(1, hpRatio)) * 0.45;
  const headSeg = hd ? 48 : 24;
  const bodySeg = hd ? 24 : 14;
  const expr = Math.max(0, Math.min(1, Number(expression) || 0));

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
  });

  return (
    <group ref={root}>
      <pointLight color={color} intensity={hd ? 2.4 : 1.25} distance={hd ? 7 : 3.5} position={[0, 0.9, 0.4]} />
      <pointLight color={accent} intensity={hd ? 1.1 : 0.45} distance={4.5} position={[0.5, 1.3, 0.6]} />
      <pointLight color={gold} intensity={0.35} distance={3} position={[-0.4, 1.1, 0.3]} />

      <mesh ref={halo} position={[0, 1.62, -0.02]}>
        <torusGeometry args={[0.2, hd ? 0.014 : 0.016, hd ? 16 : 10, hd ? 64 : 32]} />
        <Emissive color={gold} emissiveIntensity={1.6} metalness={0.6} />
      </mesh>

      {resolvedGltf ? (
        <Suspense
          fallback={
            <ProceduralBody
              color={color}
              accent={accent}
              gold={gold}
              hd={hd}
              faceMap={faceMap}
              bodySeg={bodySeg}
              headSeg={headSeg}
              expression={expr}
              breathScale={breathOn ? 1 : 0}
              hairCount={hairCount}
              wingLayers={wingLayers}
              showLattice={hd || showLattice}
            />
          }
        >
          <GltfBody url={resolvedGltf} color={color} hd={hd} />
          {(hd || showLattice) && (
            <TesseractLattice
              color={accent}
              scale={1.2}
              speed={0.8}
              opacity={0.45}
              position={[0, 0.9, 0]}
            />
          )}
          <VesselWings
            color={color}
            accent={accent}
            hd={hd}
            layers={wingLayers}
            expression={expr}
          />
        </Suspense>
      ) : (
        <ProceduralBody
          color={color}
          accent={accent}
          gold={gold}
          hd={hd}
          faceMap={faceMap}
          bodySeg={bodySeg}
          headSeg={headSeg}
          expression={expr}
          breathScale={breathOn ? 1 : 0}
          hairCount={hairCount}
          wingLayers={wingLayers}
          showLattice={hd || showLattice}
        />
      )}
    </group>
  );
}

// Preload helper for when a model URL is known at module level
export function preloadAnimaGltf(url) {
  if (url) useGLTF.preload(url);
}
