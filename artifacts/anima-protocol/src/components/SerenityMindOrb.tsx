import React, { useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';

export type Demeanor = 
  | 'calm' 
  | 'affectionate' 
  | 'devoted' 
  | 'playful' 
  | 'intense' 
  | 'transcendent';

export interface SerenityMindOrbProps {
  demeanor?: Demeanor;
  affectionLevel?: number;
  isInteracting?: boolean;
  isMax?: boolean;
  className?: string;
  onOrbClick?: () => void;
}

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

  const currentColor = useMemo(() => {
    const base = palette[demeanor];
    const affectionShift = (affectionLevel - 0.5) * 45;
    const maxBonus = isMax ? 28 : 0;

    const hue = (base.hue + affectionShift + maxBonus + 360) % 360;
    const sat = Math.min(0.96, base.sat + affectionLevel * 0.13 + (isMax ? 0.09 : 0));
    const light = Math.min(0.88, base.light + affectionLevel * 0.09 + (isMax ? 0.07 : 0));

    return new THREE.Color().setHSL(hue / 360, sat, light);
  }, [demeanor, affectionLevel, isMax]);

  // Pre-generate geometry data
  const geometryData = useMemo(() => {
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

  const { nodePositions, linePositions, nodeCount } = geometryData;

  // Floating motes positions (memoized)
  const motePositions = useMemo(() => {
    const count = isMax ? 235 : 155;
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < arr.length; i += 3) {
      const r = 1.32 + Math.random() * 0.48;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      arr[i] = r * Math.sin(phi) * Math.cos(theta);
      arr[i + 1] = r * Math.sin(phi) * Math.sin(theta);
      arr[i + 2] = r * Math.cos(phi);
    }
    return arr;
  }, [isMax]);

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

  useFrame((state) => {
    const t = state.clock.elapsedTime;

    const pulse = 1 + Math.sin(t * (1.15 + affectionLevel * 0.95)) * (0.017 + affectionLevel * 0.023 + (isMax ? 0.014 : 0));

    if (outerRef.current) outerRef.current.scale.setScalar(pulse);

    if (innerGroupRef.current) {
      const rotSpeed = 0.075 + affectionLevel * 0.065 + (isMax ? 0.045 : 0);
      innerGroupRef.current.rotation.y = t * rotSpeed;
      innerGroupRef.current.rotation.x = Math.sin(t * 0.035) * 0.28;
      innerGroupRef.current.rotation.z = Math.cos(t * 0.03) * 0.18;
    }

    if (isInteracting && coreLightRef.current) {
      coreLightRef.current.intensity = 3.4 + affectionLevel * 2.6 + Math.sin(t * 9) * 0.8;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Outer crystal */}
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

      {/* Wireframe highlight */}
      <mesh>
        <icosahedronGeometry args={[1.155, 1]} />
        <meshBasicMaterial color={currentColor} wireframe transparent opacity={0.32 + affectionLevel * 0.28} />
      </mesh>

      {/* Inner neural web */}
      <group ref={innerGroupRef}>
      
        <mesh>
          <sphereGeometry args={[0.23]} />
          <meshBasicMaterial color={currentColor} transparent opacity={0.88} />
        </mesh>

        <pointLight ref={coreLightRef} color={currentColor} intensity={2.3} distance={4.5} />

        {/* Neural nodes */}
        <points ref={pointsRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[nodePositions, 3]}
            />
          </bufferGeometry>
          <pointsMaterial size={0.052} color={currentColor} sizeAttenuation transparent opacity={0.96} />
        </points>

        {/* Connecting lines */}
        <lineSegments ref={linesRef}>
          <bufferGeometry>
            <bufferAttribute
              attach="attributes-position"
              args={[linePositions, 3]}
            />
          </bufferGeometry>
          <lineBasicMaterial color={currentColor} transparent opacity={0.52} />
        </lineSegments>
      </group>

      {/* Floating motes */}
      <points>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[motePositions, 3]}
          />
        </bufferGeometry>
        <pointsMaterial size={0.017} color={currentColor} sizeAttenuation transparent opacity={0.58} />
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
      }}
      onClick={props.onOrbClick}
    >
      <Canvas
        camera={{ position: [0, 0, 3.75], fov: 43 }}
        style={{ background: 'transparent' }}
        gl={{ alpha: true, antialias: true, powerPreference: 'high-performance' }}
      >
        <ambientLight intensity={0.18} />
        <MindCore {...props} />
        <Stars radius={85} depth={14} count={props.isMax ? 135 : 75} factor={1.6} fade speed={0.35} />
      </Canvas>
    </div>
  );
}