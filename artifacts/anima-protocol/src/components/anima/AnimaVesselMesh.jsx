import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { MeshTransmissionMaterial } from "@react-three/drei";
import * as THREE from "three";
import useFaceTexture from "@/hooks/useFaceTexture";
import TesseractLattice from "@/components/battle/TesseractLattice";
import { wPhaseScale } from "@/lib/tesseract4d";

function Emissive({ color, emissiveIntensity = 0.85, roughness = 0.22, metalness = 0.28, ...rest }) {
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

function VesselWings({ color, hd }) {
  const left = useRef(null);
  const right = useRef(null);
  useFrame((state) => {
    const flap = 0.92 + Math.sin(state.clock.elapsedTime * 2.15) * 0.32;
    if (left.current) left.current.rotation.y = -flap;
    if (right.current) right.current.rotation.y = flap;
  });
  const segs = hd ? 24 : 12;
  return (
    <group>
      {[-1, 1].map((dir) => (
        <mesh
          key={dir}
          ref={dir < 0 ? left : right}
          position={[dir * 0.2, 0.78, -0.05]}
          rotation={[0.22, dir * 0.82, dir * 0.12]}
          scale={[dir, 1, 1]}
        >
          <sphereGeometry args={[0.42, segs, segs, 0, Math.PI]} />
          <meshPhysicalMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.7}
            transparent
            opacity={0.42}
            side={THREE.DoubleSide}
            roughness={0.12}
            metalness={0.08}
            transmission={hd ? 0.55 : 0}
            thickness={0.35}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Anima vessel mesh: glass hull, portrait face, 4D tesseract cage.
 * `hd` enables drei MeshTransmissionMaterial and denser geometry.
 */
export default function AnimaVesselMesh({
  model,
  hd = false,
  flinch = 0,
  hpRatio = 1,
  facing = 1,
  showLattice = false,
}) {
  const inner = useRef(null);
  const halo = useRef(null);
  const core = useRef(null);
  const color = model?.color || "#67e8f9";
  const accent = model?.accent || "#fde68a";
  const faceMap = useFaceTexture(model?.texture_url);
  const dim = 0.5 + Math.max(0, Math.min(1, hpRatio)) * 0.5;
  const headSeg = hd ? 48 : 22;
  const bodySeg = hd ? 20 : 12;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const phase = wPhaseScale({ xw: t * 0.45, yw: t * 0.28, zw: t * 0.19 });
    const wPulse = 1 + (phase - 0.85) * 0.08;
    if (inner.current) {
      inner.current.position.y = 0.05 + Math.sin(t * 1.55) * 0.04;
      inner.current.rotation.y = (facing > 0 ? 0 : Math.PI) + Math.sin(t * 0.35) * 0.04;
      inner.current.scale.setScalar(dim * wPulse);
      const hit = flinch > 0 ? Math.sin(t * 48) * 0.05 : 0;
      inner.current.position.x = hit;
    }
    if (halo.current) {
      halo.current.rotation.z = t * 0.55;
      halo.current.rotation.x = 1.12 + Math.sin(t * 1.15) * 0.06;
    }
    if (core.current) {
      core.current.rotation.x = t * 0.4;
      core.current.rotation.y = t * 0.65;
    }
  });

  return (
    <group ref={inner}>
      <pointLight color={color} intensity={hd ? 2.2 : 1.15} distance={hd ? 6 : 3.2} />
      <pointLight color={accent} intensity={hd ? 0.9 : 0.35} distance={4} position={[0.6, 1.1, 0.5]} />
      <VesselWings color={accent} hd={hd} />

      <mesh ref={halo} position={[0, 1.28, 0]}>
        <torusGeometry args={[0.22, hd ? 0.016 : 0.018, hd ? 16 : 8, hd ? 64 : 28]} />
        <Emissive color={accent} emissiveIntensity={1.45} metalness={0.55} />
      </mesh>

      <mesh position={[0, 1.04, 0]}>
        <sphereGeometry args={[0.175, headSeg, Math.max(12, Math.floor(headSeg * 0.7))]} />
        {hd ? (
          <MeshTransmissionMaterial
            backside
            samples={6}
            resolution={256}
            thickness={0.45}
            chromaticAberration={0.06}
            anisotropy={0.25}
            distortion={0.12}
            distortionScale={0.18}
            temporalDistortion={0.08}
            color={color}
            emissive={color}
            emissiveIntensity={0.35}
            roughness={0.12}
            metalness={0.05}
            ior={1.42}
          />
        ) : (
          <Emissive color={color} emissiveIntensity={0.9} />
        )}
      </mesh>
      {faceMap && (
        <mesh position={[0, 1.04, 0.16]}>
          <circleGeometry args={[0.12, hd ? 48 : 20]} />
          <meshBasicMaterial map={faceMap} toneMapped={false} />
        </mesh>
      )}

      <mesh position={[0, 0.62, 0]}>
        <capsuleGeometry args={[0.175, 0.46, hd ? 12 : 6, bodySeg]} />
        {hd ? (
          <MeshTransmissionMaterial
            backside
            samples={5}
            resolution={192}
            thickness={0.7}
            chromaticAberration={0.04}
            color={color}
            emissive={color}
            emissiveIntensity={0.22}
            roughness={0.18}
            ior={1.38}
          />
        ) : (
          <Emissive color={color} emissiveIntensity={0.55} roughness={0.24} />
        )}
      </mesh>

      <mesh ref={core} position={[0, 0.64, 0]} scale={0.22}>
        <icosahedronGeometry args={[1, hd ? 1 : 0]} />
        <Emissive color={accent} emissiveIntensity={1.5} metalness={0.4} />
      </mesh>

      <mesh position={[0, 0.62, 0.03]} scale={[0.78, 0.92, 0.52]}>
        <capsuleGeometry args={[0.175, 0.46, 4, 8]} />
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={0.4}
          transparent
          opacity={0.32}
          toneMapped={false}
        />
      </mesh>

      <mesh position={[-0.085, 0.16, 0]}>
        <capsuleGeometry args={[0.048, 0.3, 4, hd ? 12 : 8]} />
        <Emissive color={color} emissiveIntensity={0.45} />
      </mesh>
      <mesh position={[0.085, 0.16, 0]}>
        <capsuleGeometry args={[0.048, 0.3, 4, hd ? 12 : 8]} />
        <Emissive color={color} emissiveIntensity={0.45} />
      </mesh>

      {(hd || showLattice) && (
        <TesseractLattice
          color={accent}
          scale={hd ? 1.15 : 0.95}
          speed={0.85}
          opacity={hd ? 0.55 : 0.38}
          position={[0, 0.72, 0]}
        />
      )}
    </group>
  );
}
