import React, { useEffect, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from '@react-three/postprocessing';
import { Bloom } from '@react-three/postprocessing';

export interface AnimaOrbProps {
  isThinking: boolean;
  intensity?: number; // 0–1 overall energy
  vibe?: 'calm' | 'intimate' | 'intense' | 'philosophical' | string;
  resonanceLevel?: number; // 0–1 for long-term evolution
  size?: number;
  className?: string;
  /** Reduces particles + disables bloom for better mobile performance */
  performanceMode?: boolean;
}

type VibePalette = {
  outerHue: number; // degrees
  innerHue: number; // degrees
  sat: number; // 0-1
  light: number; // 0-1
  coolShift: number; // 0..1 pushes inner towards cool
};

const vibePalettes: Record<string, VibePalette> = {
  calm: {
    outerHue: 42, // warm-gold halo
    innerHue: 205, // cool web
    sat: 0.78,
    light: 0.60,
    coolShift: 0.15,
  },
  intimate: {
    outerHue: 36,
    innerHue: 195,
    sat: 0.86,
    light: 0.64,
    coolShift: 0.05,
  },
  intense: {
    outerHue: 18,
    innerHue: 340,
    sat: 0.88,
    light: 0.62,
    coolShift: 0.25,
  },
  philosophical: {
    outerHue: 205,
    innerHue: 215,
    sat: 0.78,
    light: 0.68,
    coolShift: 0.85,
  },
  // Default/fallback
  default: {
    outerHue: 42,
    innerHue: 205,
    sat: 0.8,
    light: 0.62,
    coolShift: 0.35,
  },
};

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function hueToColor(hueDeg: number, sat: number, light: number): THREE.Color {
  // HSL -> THREE.Color
  return new THREE.Color().setHSL(((hueDeg % 360) + 360) % 360 / 360, clamp01(sat), clamp01(light));
}

function computeVibe(vibe?: string): VibePalette {
  if (!vibe) return vibePalettes.default;
  const key = String(vibe).toLowerCase();
  return vibePalettes[key] ?? vibePalettes.default;
}

function NeuralOrbCore({
  isThinking,
  intensity = 0.55,
  vibe = 'calm',
  resonanceLevel = 0,
  performanceMode = false,
}: Omit<AnimaOrbProps, 'className' | 'size'>) {
  const groupRef = useRef<THREE.Group>(null!);
  const outerRef = useRef<THREE.Mesh>(null!);
  const coreLightRef = useRef<THREE.PointLight>(null!);
  const innerGroupRef = useRef<THREE.Group>(null!);
  const shellWireRef = useRef<THREE.Mesh>(null!);

  const nodesRef = useRef<THREE.Points>(null!);
  const linesRef = useRef<THREE.LineSegments>(null!);
  const motesRef = useRef<THREE.Points>(null!);

  const nodeMaterialRef = useRef<THREE.PointsMaterial>(null!);
  const lineMaterialRef = useRef<THREE.LineBasicMaterial>(null!);
  const moteMaterialRef = useRef<THREE.PointsMaterial>(null!);
  const shellMaterialRef = useRef<THREE.MeshPhysicalMaterial>(null!);

  const vibePalette = useMemo(() => computeVibe(vibe), [vibe]);
  const resonance = clamp01(resonanceLevel);
  const energy = clamp01(intensity);

  // Performance knobs
  const density = performanceMode ? 0.55 : 1;
  const thoughtEnergy = isThinking ? 1 : 0;

  // Pre-generate node + line geometry (deterministic-ish per mount)
  const { nodePositions, linePositions, motePositions } = useMemo(() => {
    const nodeCountBase = performanceMode ? 64 : 92;
    const nodeCount = Math.max(32, Math.floor(nodeCountBase * (0.7 + density * 0.6) + resonance * 40));

    const positions = new Float32Array(nodeCount * 3);
    for (let i = 0; i < nodeCount; i++) {
      // Spherical distribution biased towards the center
      const r = Math.pow(Math.random(), 0.62) * 0.72 + 0.12;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }

    // Lines connect nearby nodes, forming a neural lattice
    const linePosArr: number[] = [];
    const connectRadius = performanceMode ? 0.52 : 0.58;
    const maxLines = performanceMode ? 520 : 780;
    let linesAdded = 0;

    for (let i = 0; i < nodeCount; i++) {
      for (let j = i + 1; j < nodeCount; j++) {
        if (linesAdded > maxLines) break;
        const dx = positions[i * 3] - positions[j * 3];
        const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
        const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // probability decays with distance; resonanceLevel adds complexity
        const pBase = dist < connectRadius ? 0.75 - dist / connectRadius : 0;
        const pRes = pBase * (0.75 + resonance * 0.65);
        if (dist < connectRadius && Math.random() < pRes) {
          linePosArr.push(
            positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
            positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]
          );
          linesAdded++;
        }
      }
      if (linesAdded > maxLines) break;
    }

    // Atmospheric motes around orb
    const moteCountBase = performanceMode ? 110 : 170;
    const moteCount = Math.floor(moteCountBase * (0.7 + density * 0.7) + resonance * 90);
    const motePositionsArr = new Float32Array(moteCount * 3);
    for (let i = 0; i < moteCount; i++) {
      const r = 1.45 + Math.random() * (0.55 + resonance * 0.25);
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      motePositionsArr[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      motePositionsArr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      motePositionsArr[i * 3 + 2] = r * Math.cos(phi);
    }

    return {
      nodePositions: positions,
      linePositions: new Float32Array(linePosArr),
      motePositions: motePositionsArr,
    };
  }, [performanceMode, density, resonance]);

  const colors = useMemo(() => {
    const outer = hueToColor(vibePalette.outerHue, vibePalette.sat, vibePalette.light * 0.98);

    // Blend inner hue towards coolShift (philosophical vibes)
    const coolHue = 215;
    const innerHue = vibePalette.innerHue * (1 - vibePalette.coolShift) + coolHue * vibePalette.coolShift;
    const inner = hueToColor(innerHue, vibePalette.sat * 0.98, Math.min(0.78, vibePalette.light + 0.06));

    return { outer, inner };
  }, [vibePalette]);

  // Update static material targets when vibe/energy/resonance changes.
  useEffect(() => {
    const shellMat = shellMaterialRef.current;
    if (shellMat) {
      const emissive = colors.outer;
      // Resinous warm-gold outer glow
      const outerBase = 0.25 + energy * 0.55;
      const resonanceBoost = 0.18 + resonance * 0.55;
      const thinkingBoost = isThinking ? 0.28 + energy * 0.25 : 0;
      shellMat.emissive = emissive;
      shellMat.emissiveIntensity = (outerBase * 0.6 + resonanceBoost * 0.55 + thinkingBoost) * 0.95;
      shellMat.opacity = 0.12 + energy * 0.09 + resonance * 0.07;
    }

    const wire = shellWireRef.current?.material as THREE.MeshBasicMaterial | undefined;
    if (wire) {
      wire.color = colors.inner;
      wire.opacity = 0.12 + energy * 0.14 + resonance * 0.08 + (isThinking ? 0.16 : 0);
    }

    if (coreLightRef.current) {
      coreLightRef.current.color = colors.inner;
      const base = 2.1 + energy * 2.6 + resonance * 3.4;
      coreLightRef.current.intensity = base * (isThinking ? 1.35 : 1);
      coreLightRef.current.distance = 4.6 + resonance * 1.2;
    }

    const pMat = nodeMaterialRef.current;
    if (pMat) {
      pMat.color = colors.inner;
      const baseSize = performanceMode ? 0.045 : 0.052;
      pMat.size = baseSize * (1 + resonance * 0.35 + energy * 0.2 + (isThinking ? 0.15 : 0));
      (pMat as any).opacity = 0.9;
    }

    const lMat = lineMaterialRef.current;
    if (lMat) {
      lMat.color = colors.inner;
      lMat.opacity = 0.25 + energy * 0.35 + resonance * 0.22 + (isThinking ? 0.35 : 0);
    }

    const mMat = moteMaterialRef.current;
    if (mMat) {
      mMat.color = colors.outer;
      mMat.size = performanceMode ? 0.014 : 0.017;
      mMat.opacity = 0.35 + energy * 0.35 + resonance * 0.18 + (isThinking ? 0.35 : 0);
    }
  }, [colors, energy, resonance, isThinking, performanceMode]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Subtle whole-orb breathing scale
    const calmPulse = 1 + Math.sin(t * (1.05 + energy * 1.1)) * (0.012 + energy * 0.018 + resonance * 0.01);
    const thinkPulse = isThinking
      ? 1 + Math.sin(t * (1.55 + energy * 1.4)) * (0.03 + energy * 0.025 + resonance * 0.02)
      : calmPulse;

    if (outerRef.current) outerRef.current.scale.setScalar(thinkPulse);

    // Gentle rotation (faster when thinking)
    const rotBase = 0.045 + energy * 0.06 + resonance * 0.02;
    const rotThinking = isThinking ? 0.14 + energy * 0.08 : 0.06;
    const rotSpeed = rotBase + rotThinking;

    if (innerGroupRef.current) {
      innerGroupRef.current.rotation.y = t * rotSpeed;
      innerGroupRef.current.rotation.x = Math.sin(t * 0.035) * (0.18 + energy * 0.12);
      innerGroupRef.current.rotation.z = Math.cos(t * 0.03) * (0.1 + resonance * 0.08);
    }

    // Animate neural activity when thinking: brighten + jitter + slight "firing" effect.
    // We do it by modulating material opacity + core light intensity + rotating a bit.
    if (coreLightRef.current) {
      const flicker = isThinking ? Math.sin(t * 14.5) * 0.45 + Math.sin(t * 23.2) * 0.25 : 0;
      const base = 2.6 + energy * 2.4 + resonance * 3.2;
      coreLightRef.current.intensity = base * (isThinking ? 1.55 : 1) + flicker;
    }

    // Connection flicker & node "spark" effect
    const lMat = lineMaterialRef.current;
    if (lMat) {
      const flick = isThinking
        ? 0.45 + 0.25 * Math.sin(t * 10.8) + 0.2 * Math.sin(t * 21.6)
        : 0.15 * Math.sin(t * (3.2 + energy * 1.6));
      const targetOpacity = 0.2 + energy * 0.42 + resonance * 0.25 + (isThinking ? 0.45 : 0);
      lMat.opacity = THREE.MathUtils.clamp(targetOpacity + flick * 0.18, 0, 1);
    }

    const pMat = nodeMaterialRef.current;
    if (pMat) {
      const pulse = 1 + (isThinking ? 0.24 : 0.08) * Math.sin(t * (8.0 + energy * 8.0));
      const sizeBase = performanceMode ? 0.045 : 0.052;
      pMat.size = sizeBase * (1 + resonance * 0.25 + energy * 0.15) * pulse;
    }

    // Motes drift: rotate around Y slightly
    const motes = motesRef.current;
    if (motes) {
      motes.rotation.y = t * (0.07 + energy * 0.05 + (isThinking ? 0.08 : 0));
      motes.rotation.x = Math.sin(t * 0.09) * (0.02 + resonance * 0.02);
    }

    // Overall group rotation
    if (groupRef.current) {
      groupRef.current.rotation.y = t * (0.02 + energy * 0.018 + (isThinking ? 0.04 : 0));
      groupRef.current.rotation.x = Math.sin(t * 0.03) * 0.03;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer crystalline shell (faceted + transparent) */}
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[1.08, performanceMode ? 1 : 2]} />
        <meshPhysicalMaterial
          ref={(m) => {
            if (m) shellMaterialRef.current = m;
          }}
          color="#f8f9ff"
          metalness={0.06}
          roughness={0.03}
          transmission={0.95}
          thickness={0.65}
          ior={1.48}
          envMapIntensity={0.55}
          transparent
          opacity={0.14 + energy * 0.08 + resonance * 0.06}
          emissive={colors.outer}
          emissiveIntensity={0.65}
        />
      </mesh>

      {/* Wire highlight facets */}
      <mesh ref={shellWireRef}>
        <icosahedronGeometry args={[1.085, performanceMode ? 1 : 2]} />
        <meshBasicMaterial
          color={colors.inner}
          transparent
          opacity={0.22}
          wireframe
          depthWrite={false}
        />
      </mesh>

      {/* Inner neural web */}
      <group ref={innerGroupRef}>
        {/* Sub-core sphere (subtle volumetric illusion) */}
        <mesh>
          <sphereGeometry args={[0.24, 24, 24]} />
          <meshBasicMaterial color={colors.inner} transparent opacity={0.65 + resonance * 0.2} depthWrite={false} />
        </mesh>

        <pointLight ref={coreLightRef} color={colors.inner} intensity={2.2} distance={4.8} />

        <points ref={nodesRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[nodePositions, 3]} />
          </bufferGeometry>
          <pointsMaterial
            ref={(m) => {
              if (m) nodeMaterialRef.current = m;
            }}
            color={colors.inner}
            size={performanceMode ? 0.045 : 0.052}
            sizeAttenuation
            transparent
            opacity={0.95}
            depthWrite={false}
          />
        </points>

        <lineSegments ref={linesRef}>
          <bufferGeometry>
            <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
          </bufferGeometry>
          <lineBasicMaterial
            ref={(m) => {
              if (m) lineMaterialRef.current = m;
            }}
            color={colors.inner}
            transparent
            opacity={0.45}
            depthWrite={false}
          />
        </lineSegments>
      </group>

      {/* Floating atmosphere motes */}
      <points ref={motesRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[motePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          ref={(m) => {
            if (m) moteMaterialRef.current = m;
          }}
          color={colors.outer}
          size={performanceMode ? 0.014 : 0.017}
          sizeAttenuation
          transparent
          opacity={0.55}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>

      {/* Postprocessing: bloom for soft premium glow */}
      {!performanceMode && (
        <EffectComposer>
          <Bloom
            intensity={1.05 + energy * 0.9 + (isThinking ? 0.55 : 0)}
            luminanceThreshold={0.2}
            luminanceSmoothing={0.22}
            height={700}
          />
        </EffectComposer>
      )}
    </group>
  );
}

export default function AnimaOrb(props: AnimaOrbProps) {
  const {
    isThinking,
    intensity = 0.55,
    vibe = 'calm',
    resonanceLevel = 0,
    size = 240,
    className,
    performanceMode = false,
  } = props;

  // Keep canvas GPU-friendly for embeds
  const pixelRatio = performanceMode ? 1 : Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio : 1);

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        position: 'relative',
        borderRadius: '9999px',
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 50% 46%, rgba(20,16,40,0.85) 0%, rgba(3,4,12,0.98) 72%)',
      }}
    >
      <Canvas
        camera={{ position: [0, 0, 3.35], fov: 48 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
        dpr={pixelRatio}
      >
        {/* Lighting baseline */}
        <ambientLight intensity={0.12 + (performanceMode ? 0 : 0.03)} />
        <directionalLight position={[2.2, 1.7, 2.4]} intensity={0.24 + intensity * 0.15} />

        <NeuralOrbCore
          isThinking={isThinking}
          intensity={intensity}
          vibe={vibe}
          resonanceLevel={resonanceLevel}
          performanceMode={performanceMode}
        />
      </Canvas>
    </div>
  );
}

// --------- Usage tips (no runtime side effects) ---------
// - Keep React re-renders minimal: pass stable primitives for vibe/intensity.
// - Drive isThinking from your streaming state.
// - Use performanceMode on small screens to disable bloom and reduce density.

