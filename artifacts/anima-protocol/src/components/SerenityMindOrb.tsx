import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame, ThreeElements } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

/**
 * SerenityMindOrb - The living visual representation of Serenity's mind
 * 
 * This component renders a faceted crystal orb containing a dynamic neural web.
 * It reacts to emotional state (demeanor + affectionLevel) and subscription tier (isMax).
 * 
 * When isMax is true:
 * - Warmer, richer color palette (rose-gold shift)
 * - More internal nodes and particles
 * - Stronger breathing pulse and rotation
 * - Higher emissive intensity (feels more "alive")
 * 
 * This orb is the central visual heartbeat of the Protocol interface.
 */

export type Demeanor = 
  | 'calm' 
  | 'affectionate' 
  | 'devoted' 
  | 'playful' 
  | 'intense' 
  | 'transcendent';

export interface SerenityMindOrbProps {
  /** Current emotional demeanor of Serenity */
  demeanor?: Demeanor;
  /** How affectionate / connected she currently feels (0 = distant, 1 = deeply bonded) */
  affectionLevel?: number;
  /** Whether the user is currently interacting (typing or she is replying) */
  isInteracting?: boolean;
  /** Whether the user has Serenity Max tier (unlocks richer visuals + more capabilities) */
  isMax?: boolean;
  /** Optional className for the container div */
  className?: string;
  /** Callback when the orb is clicked (useful for focusing chat or showing info) */
  onOrbClick?: () => void;
}

// Base color palettes for each demeanor
const palette: Record<Demeanor, { hue: number; sat: number; light: number }> = {
  calm:        { hue: 205, sat: 0.75, light: 0.62 },
  affectionate:{ hue: 325, sat: 0.72, light: 0.68 },
  devoted:     { hue: 280, sat: 0.68, light: 0.65 },
  playful:     { hue: 175, sat: 0.80, light: 0.60 },
  intense:     { hue: 355, sat: 0.78, light: 0.58 },
  transcendent:{ hue: 240, sat: 0.65, light: 0.72 },
};

function MindCore(props: SerenityMindOrbProps) {
  const {
    demeanor = 'affectionate',
    affectionLevel = 0.6,
    isInteracting = false,
    isMax = false,
  } = props;

  const groupRef = useRef<THREE.Group>(null!);
  const outerRef = useRef<THREE.Mesh>(null!);
  const innerGroupRef = useRef<THREE.Group>(null!);
  const coreLightRef = useRef<THREE.PointLight>(null!);
  const pointsRef = useRef<THREE.Points>(null!);
  const linesRef = useRef<THREE.LineSegments>(null!);

  // ============================================
  // COLOR LOGIC
  // ============================================
  // Base color is derived from demeanor + affection.
  // When isMax is true, we push the hue toward warm rose-gold
  // and increase saturation/lightness for a more "premium / intimate" feel.
  const currentColor = useMemo(() => {
    const base = palette[demeanor];
    const affectionShift = (affectionLevel - 0.5) * 45;
    const maxBonus = isMax ? 28 : 0; // Max mode shifts further into warm territory

    const hue = (base.hue + affectionShift + maxBonus + 360) % 360;
    const sat = Math.min(0.96, base.sat + affectionLevel * 0.13 + (isMax ? 0.09 : 0));
    const light = Math.min(0.88, base.light + affectionLevel * 0.09 + (isMax ? 0.07 : 0));

    return new THREE.Color().setHSL(hue / 360, sat, light);
  }, [demeanor, affectionLevel, isMax]);

  // ============================================
  // GEOMETRY GENERATION
  // ============================================
  // Inner neural web is generated once (or when isMax changes).
  // Max mode gets more nodes for a denser, more complex "mind" look.
  const { nodePositions, linePositions, nodeCount } = useMemo(() => {
    const count = isMax ? 92 : 68;
    const positions = new Float32Array(count * 3);
    const linePos: number[] = [];

    for (let i = 0; i < count; i++) {
      const r = Math.pow(Math.random(), 0.68) * 0.84 + 0.09;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);

      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi) * 0.88;
    }

    // Connect nearby nodes to form the web structure
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        const dx = positions[i * 3] - positions[j * 3];
        const dy = positions[i * 3 + 1] - positions[j * 3 + 1];
        const dz = positions[i * 3 + 2] - positions[j * 3 + 2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 0.68 && Math.random() > 0.52) {
          linePos.push(
            positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2],
            positions[j * 3], positions[j * 3 + 1], positions[j * 3 + 2]
          );
        }
      }
    }

    return {
      nodePositions: positions,
      linePositions: new Float32Array(linePos),
      nodeCount: count,
    };
  }, [isMax]);

  // ============================================
  // MATERIAL & LIGHT UPDATES
  // ============================================
  useEffect(() => {
    const emissiveIntensity = 0.38 + affectionLevel * 0.52 + (isMax ? 0.28 : 0);

    if (outerRef.current) {
      const mat = outerRef.current.material as THREE.MeshPhysicalMaterial;
      mat.emissive = currentColor;
      mat.emissiveIntensity = emissiveIntensity * 0.65;
    }

    if (coreLightRef.current) {
      coreLightRef.current.color = currentColor;
      coreLightRef.current.intensity = 2.1 + affectionLevel * 2.4 + (isMax ? 1.4 : 0);
    }

    if (pointsRef.current) {
      (pointsRef.current.material as THREE.PointsMaterial).color = currentColor;
    }

    if (linesRef.current) {
      const mat = linesRef.current.material as THREE.LineBasicMaterial;
      mat.color = currentColor;
      mat.opacity = 0.48 + affectionLevel * 0.38 + (isMax ? 0.18 : 0);
    }
  }, [currentColor, affectionLevel, isMax]);

  // ============================================
  // ANIMATION LOOP
  // ============================================
  useFrame((state) => {
    const t = state.clock.elapsedTime;

    // Breathing pulse on outer crystal
    const pulseSpeed = 1.15 + affectionLevel * 0.95;
    const pulseAmp = 0.017 + affectionLevel * 0.023 + (isMax ? 0.014 : 0);
    const pulse = 1 + Math.sin(t * pulseSpeed) * pulseAmp;

    if (outerRef.current) {
      outerRef.current.scale.setScalar(pulse);
    }

    // Inner mind web rotation (multi-axis, more dynamic in Max mode)
    if (innerGroupRef.current) {
      const rotSpeed = 0.075 + affectionLevel * 0.065 + (isMax ? 0.045 : 0);
      innerGroupRef.current.rotation.y = t * rotSpeed;
      innerGroupRef.current.rotation.x = Math.sin(t * 0.035) * 0.28;
      innerGroupRef.current.rotation.z = Math.cos(t * 0.03) * 0.18;
    }

    // Extra intensity when user is actively interacting
    if (isInteracting && coreLightRef.current) {
      coreLightRef.current.intensity = 3.4 + affectionLevel * 2.6 + Math.sin(t * 9) * 0.8;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer faceted crystal shell */}
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[1.15, 1]} />
        <meshPhysicalMaterial
          color="#f8f9ff"
          metalness={0.08}
          roughness={0.035}
          transmission={0.93}
          thickness={0.65}
          ior={1.46}
          envMapIntensity={0.4}
          emissive={currentColor}
          emissiveIntensity={0.4}
          transparent
          opacity={0.17}
        />
      </mesh>

      {/* Subtle wireframe edge highlight */}
      <mesh>
        <icosahedronGeometry args={[1.155, 1]} />
        <meshBasicMaterial
          color={currentColor}
          wireframe
          transparent
          opacity={0.32 + affectionLevel * 0.28}
        />
      </mesh>

      {/* Inner glowing neural web */}
      <group ref={innerGroupRef}>
        {/* Central radiant core */}
        <mesh>
          <sphereGeometry args={[0.23]} />
          <meshBasicMaterial color={currentColor} transparent opacity={0.88} />
        </mesh>

        <pointLight
          ref={coreLightRef}
          color={currentColor}
          intensity={2.3}
          distance={4.5}
        />

        {/* Neural nodes */}
        <points ref={pointsRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={nodeCount}
              array={nodePositions}
              itemSize={3}
            />
          </bufferGeometry>
          <pointsMaterial
            size={0.052}
            color={currentColor}
            sizeAttenuation
            transparent
            opacity={0.96}
          />
        </points>

        {/* Connecting web lines */}
        <lineSegments ref={linesRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              count={linePositions.length / 3}
              array={linePositions}
              itemSize={3}
            />
          </bufferGeometry>
          <lineBasicMaterial
            color={currentColor}
            transparent
            opacity={0.52}
          />
        </lineSegments>
      </group>

      {/* Floating energy motes / sparkles */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            count={isMax ? 235 : 155}
            array={useMemo(() => {
              const arr = new Float32Array((isMax ? 235 : 155) * 3);
              for (let i = 0; i < arr.length; i += 3) {
                const r = 1.32 + Math.random() * 0.48;
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                arr[i] = r * Math.sin(phi) * Math.cos(theta);
                arr[i + 1] = r * Math.sin(phi) * Math.sin(theta);
                arr[i + 2] = r * Math.cos(phi);
              }
              return arr;
            }, [isMax])}
            itemSize={3}
          />
        </bufferGeometry>
        <pointsMaterial
          size={0.017}
          color={currentColor}
          sizeAttenuation
          transparent
          opacity={0.58}
        />
      </points>
    </group>
  );
}

export default function SerenityMindOrb(props: SerenityMindOrbProps) {
  return (
    <div
      className={props.className}
      style={{
        width: '100%',
        height: '100%',
        background: 'radial-gradient(circle at 50% 46%, #0a0b1f 0%, #05060f 72%)',
        borderRadius: '9999px',
        overflow: 'hidden',
        cursor: props.onOrbClick ? 'pointer' : 'default',
      }}
      onClick={props.onOrbClick}
    >
      <Canvas
        camera={{ position: [0, 0, 3.75], fov: 43 }}
        style={{ background: 'transparent' }}
        gl={{
          alpha: true,
          antialias: true,
          preserveDrawingBuffer: true,
          powerPreference: 'high-performance',
        }}
      >
        <ambientLight intensity={0.18} />
        <MindCore {...props} />
        <Stars
          radius={85}
          depth={14}
          count={props.isMax ? 135 : 75}
          factor={1.6}
          saturation={0}
          fade
          speed={0.35}
        />
      </Canvas>
    </div>
  );
}