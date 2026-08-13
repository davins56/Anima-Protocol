import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import {
  TESSERACT_LINE_FLOATS,
  createTesseractLinePositions,
  writeTesseractLinePositions,
} from "@/lib/tesseract4d";

/**
 * Animated 4D hypercube projected into the NetBattle volume.
 * Rotates through XW / YW / ZW so the lattice breathes instead of spinning in 3D.
 */
export default function TesseractLattice({
  color = "#67e8f9",
  scale = 1.6,
  speed = 1,
  opacity = 0.42,
  cameraW = 2.45,
  position = [0, 1.15, 0],
}) {
  const geom = useRef(null);
  const positions = useMemo(() => {
    const buf = new Float32Array(TESSERACT_LINE_FLOATS);
    createTesseractLinePositions({ xw: 0.2 }, cameraW, scale).forEach((n, i) => {
      buf[i] = n;
    });
    return buf;
  }, [cameraW, scale]);

  useFrame((state) => {
    const t = state.clock.elapsedTime * speed;
    writeTesseractLinePositions(
      positions,
      {
        xw: t * 0.37,
        yw: t * 0.21,
        zw: t * 0.16,
        xy: t * 0.05,
        yz: Math.sin(t * 0.13) * 0.2,
      },
      cameraW,
      scale,
    );
    const attr = geom.current?.attributes?.position;
    if (attr) attr.needsUpdate = true;
  });

  return (
    <lineSegments position={position}>
      <bufferGeometry ref={geom}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <lineBasicMaterial
        color={color}
        transparent
        opacity={opacity}
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
      />
    </lineSegments>
  );
}
