/**
 * 3D versions of the resonance node glyphs (Figma: ResonanceGlyph / Band=*):
 * noise = jagged glitch shard, ambient = soft diffuse ring, data = hexagon
 * lattice, rare = four-point star with halo, serenity = concentric rings with
 * a winged sigil. Used for viruses (their band), off-layer ghosts and the
 * phase-shift afterimage.
 */
import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BAND_BY_KEY, type BandKey } from "@/lib/sim/engine";

type Props = { band: BandKey; opacity?: number; scale?: number; spin?: boolean; position?: [number, number, number] };

function Mat({ color, opacity, wire = false }: { color: string; opacity: number; wire?: boolean }) {
  return (
    <meshBasicMaterial
      color={color}
      transparent
      opacity={opacity}
      wireframe={wire}
      depthWrite={false}
      toneMapped={false}
      side={THREE.DoubleSide}
    />
  );
}

export default function BandGlyph({ band, opacity = 0.9, scale = 1, spin = true, position = [0, 0, 0] }: Props) {
  const g = useRef<THREE.Group>(null);
  const color = BAND_BY_KEY[band].color;
  useFrame((st, dt) => {
    if (!g.current || !spin) return;
    g.current.rotation.y += dt * (band === "noise" ? 2.4 : 0.6);
    if (band === "noise") g.current.position.x = position[0] + (Math.sin(st.clock.elapsedTime * 53) > 0.92 ? 0.04 : 0);
  });
  return (
    <group ref={g} position={position} scale={scale}>
      {band === "noise" && (
        <>
          <mesh scale={[0.18, 0.42, 0.1]} rotation={[0, 0, 0.35]}>
            <octahedronGeometry args={[1, 0]} />
            <Mat color={color} opacity={opacity} />
          </mesh>
          <mesh position={[0.16, -0.12, 0]} scale={[0.08, 0.2, 0.06]} rotation={[0, 0, -0.6]}>
            <tetrahedronGeometry args={[1, 0]} />
            <Mat color={color} opacity={opacity * 0.8} />
          </mesh>
          <mesh position={[-0.14, 0.18, 0]} scale={[0.06, 0.14, 0.05]} rotation={[0, 0, 0.9]}>
            <tetrahedronGeometry args={[1, 0]} />
            <Mat color={color} opacity={opacity * 0.7} />
          </mesh>
        </>
      )}
      {band === "ambient" && (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.28, 0.035, 8, 40]} />
            <Mat color={color} opacity={opacity} />
          </mesh>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.4, 0.09, 8, 40]} />
            <Mat color={color} opacity={opacity * 0.25} />
          </mesh>
        </>
      )}
      {band === "data" && (
        <>
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.34, 0.34, 0.04, 6, 1, true]} />
            <Mat color={color} opacity={opacity} wire />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[0.2, 0]} />
            <Mat color={color} opacity={opacity * 0.85} wire />
          </mesh>
        </>
      )}
      {band === "rare" && (
        <>
          <mesh scale={[0.06, 0.5, 0.06]} rotation={[0, 0, Math.PI / 4]}>
            <octahedronGeometry args={[1, 0]} />
            <Mat color={color} opacity={opacity} />
          </mesh>
          <mesh scale={[0.06, 0.5, 0.06]} rotation={[0, 0, -Math.PI / 4]}>
            <octahedronGeometry args={[1, 0]} />
            <Mat color={color} opacity={opacity} />
          </mesh>
          <mesh>
            <ringGeometry args={[0.3, 0.34, 40]} />
            <Mat color={color} opacity={opacity * 0.5} />
          </mesh>
        </>
      )}
      {band === "serenity" && (
        <>
          {[0.16, 0.26, 0.36].map((r, i) => (
            <mesh key={r} rotation={[Math.PI / 2, 0, 0]}>
              <torusGeometry args={[r, 0.014, 6, 48]} />
              <Mat color={color} opacity={opacity * (1 - i * 0.25)} />
            </mesh>
          ))}
          {[-1, 1].map((s) => (
            <mesh key={s} position={[s * 0.3, 0.08, 0]} rotation={[0, 0, s * -0.9]} scale={[0.07, 0.26, 0.02]}>
              <coneGeometry args={[1, 1, 3]} />
              <Mat color={color} opacity={opacity * 0.9} />
            </mesh>
          ))}
        </>
      )}
    </group>
  );
}
