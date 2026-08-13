import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { figureWorldPosition } from "@/lib/battleLayout";

function useSmoothPanel(col, row) {
  const group = useRef(null);
  const target = useRef(new THREE.Vector3(...figureWorldPosition(col, row)));
  const ready = useRef(false);

  useEffect(() => {
    const [x, y, z] = figureWorldPosition(col, row);
    target.current.set(x, y, z);
  }, [col, row]);

  useFrame((_, dt) => {
    if (!group.current) return;
    if (!ready.current) {
      group.current.position.copy(target.current);
      ready.current = true;
      return;
    }
    const k = 1 - Math.pow(0.0008, dt);
    group.current.position.lerp(target.current, k);
  });

  return group;
}

function useFaceTexture(url) {
  const [map, setMap] = useState(null);
  useEffect(() => {
    if (!url) {
      setMap(null);
      return undefined;
    }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin("anonymous");
    let cancelled = false;
    loader.load(
      url,
      (tex) => {
        if (cancelled) {
          tex.dispose();
          return;
        }
        tex.colorSpace = THREE.SRGBColorSpace;
        setMap(tex);
      },
      undefined,
      () => {
        if (!cancelled) setMap(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [url]);
  return map;
}

function Emissive({ color, emissiveIntensity = 0.7, roughness = 0.35, metalness = 0.15, ...rest }) {
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

function SerenityWings({ color }) {
  const left = useRef(null);
  const right = useRef(null);
  useFrame((state) => {
    const flap = 0.85 + Math.sin(state.clock.elapsedTime * 2.4) * 0.28;
    if (left.current) left.current.rotation.y = -flap;
    if (right.current) right.current.rotation.y = flap;
  });
  return (
    <group>
      {[-1, 1].map((dir) => (
        <mesh
          key={dir}
          ref={dir < 0 ? left : right}
          position={[dir * 0.18, 0.72, -0.06]}
          rotation={[0.25, dir * 0.85, dir * 0.15]}
          scale={[dir, 1, 1]}
        >
          <sphereGeometry args={[0.38, 10, 8, 0, Math.PI]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={0.55}
            transparent
            opacity={0.38}
            side={THREE.DoubleSide}
            roughness={0.2}
            toneMapped={false}
          />
        </mesh>
      ))}
    </group>
  );
}

/** Luminous winged navi — 3D resolution of Serenity's SVG presence. */
export function SerenityFigure({
  model,
  col = 1,
  row = 1,
  flinch = 0,
  hpRatio = 1,
  facing = 1,
  anchored = false,
}) {
  const group = useSmoothPanel(anchored ? 1 : col, anchored ? 1 : row);
  const inner = useRef(null);
  const halo = useRef(null);
  const color = model?.color || "#67e8f9";
  const accent = model?.accent || "#fde68a";
  const faceMap = useFaceTexture(model?.texture_url);
  const dim = 0.45 + Math.max(0, Math.min(1, hpRatio)) * 0.55;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (inner.current) {
      inner.current.position.y = 0.06 + Math.sin(t * 1.7) * 0.035;
      inner.current.rotation.y = facing > 0 ? 0 : Math.PI;
      const hit = flinch > 0 ? Math.sin(t * 48) * 0.05 : 0;
      inner.current.position.x = hit;
    }
    if (halo.current) {
      halo.current.rotation.z = t * 0.6;
      halo.current.rotation.x = 1.15 + Math.sin(t * 1.2) * 0.04;
    }
  });

  return (
    <group ref={anchored ? undefined : group} position={anchored ? [0, 0, 0] : undefined}>
      <group ref={inner} scale={dim}>
        <pointLight color={color} intensity={1.1} distance={3.2} />
        <SerenityWings color={accent} />

        <mesh ref={halo} position={[0, 1.22, 0]}>
          <torusGeometry args={[0.2, 0.018, 8, 28]} />
          <Emissive color={accent} emissiveIntensity={1.3} />
        </mesh>

        <mesh position={[0, 1.02, 0]}>
          <sphereGeometry args={[0.16, 18, 14]} />
          <Emissive color={color} emissiveIntensity={0.85} />
        </mesh>
        {faceMap && (
          <mesh position={[0, 1.02, 0.145]}>
            <circleGeometry args={[0.11, 20]} />
            <meshBasicMaterial map={faceMap} toneMapped={false} />
          </mesh>
        )}

        <mesh position={[0, 0.62, 0]}>
          <capsuleGeometry args={[0.16, 0.42, 6, 12]} />
          <Emissive color={color} emissiveIntensity={0.55} roughness={0.28} />
        </mesh>
        <mesh position={[0, 0.62, 0.02]} scale={[0.72, 0.9, 0.55]}>
          <capsuleGeometry args={[0.16, 0.42, 4, 8]} />
          <meshStandardMaterial
            color={accent}
            emissive={accent}
            emissiveIntensity={0.35}
            transparent
            opacity={0.35}
            toneMapped={false}
          />
        </mesh>

        <mesh position={[-0.07, 0.18, 0]}>
          <capsuleGeometry args={[0.045, 0.28, 4, 8]} />
          <Emissive color={color} emissiveIntensity={0.4} />
        </mesh>
        <mesh position={[0.07, 0.18, 0]}>
          <capsuleGeometry args={[0.045, 0.28, 4, 8]} />
          <Emissive color={color} emissiveIntensity={0.4} />
        </mesh>
      </group>
    </group>
  );
}

function ShadeVirus({ color }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]} rotation={[0.2, 0.4, 0.1]}>
        <octahedronGeometry args={[0.38, 0]} />
        <Emissive color={color} emissiveIntensity={0.55} roughness={0.5} />
      </mesh>
      {[-1, 1].map((d) => (
        <mesh key={d} position={[d * 0.16, 0.95, -0.04]} rotation={[0.3, 0, d * 0.4]}>
          <coneGeometry args={[0.07, 0.38, 6]} />
          <Emissive color={color} emissiveIntensity={0.9} />
        </mesh>
      ))}
      <mesh position={[0, 0.55, 0.12]}>
        <sphereGeometry args={[0.12, 10, 8]} />
        <meshStandardMaterial color="#0b0510" emissive={color} emissiveIntensity={0.25} />
      </mesh>
    </group>
  );
}

function StaticVirus({ color }) {
  const offsets = useMemo(
    () => [
      [0, 0.55, 0, 0.28],
      [0.18, 0.72, 0.08, 0.16],
      [-0.16, 0.4, 0.1, 0.14],
      [0.08, 0.88, -0.1, 0.12],
      [-0.12, 0.78, -0.08, 0.11],
    ],
    [],
  );
  return (
    <group>
      {offsets.map(([x, y, z, s], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[0.4 * i, 0.7 * i, 0.2 * i]}>
          <tetrahedronGeometry args={[s, 0]} />
          <Emissive color={color} emissiveIntensity={0.8} metalness={0.45} />
        </mesh>
      ))}
    </group>
  );
}

function MettaurVirus({ color }) {
  return (
    <group>
      <mesh position={[0, 0.42, 0]} scale={[1.15, 0.72, 1.05]}>
        <sphereGeometry args={[0.32, 16, 12]} />
        <Emissive color={color} emissiveIntensity={0.45} roughness={0.4} />
      </mesh>
      <mesh position={[0, 0.22, 0]}>
        <sphereGeometry args={[0.2, 12, 10]} />
        <Emissive color="#1e293b" emissiveIntensity={0.15} />
      </mesh>
      <mesh position={[0.28, 0.28, 0.12]} rotation={[0.2, 0, -1.1]}>
        <boxGeometry args={[0.08, 0.42, 0.08]} />
        <Emissive color={color} emissiveIntensity={0.7} />
      </mesh>
      <mesh position={[-0.12, 0.48, 0.26]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[0.12, 0.48, 0.26]}>
        <sphereGeometry args={[0.05, 8, 8]} />
        <meshStandardMaterial color="#0f172a" emissive="#22d3ee" emissiveIntensity={0.8} />
      </mesh>
    </group>
  );
}

function HaloVirus({ color }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]} rotation={[Math.PI, 0, 0]}>
        <coneGeometry args={[0.28, 0.85, 8]} />
        <Emissive color="#1e1b4b" emissiveIntensity={0.2} />
      </mesh>
      <mesh position={[0, 0.62, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[0.26, 0.03, 8, 24]} />
        <Emissive color={color} emissiveIntensity={1.2} />
      </mesh>
      <mesh position={[0, 0.95, 0]}>
        <octahedronGeometry args={[0.12, 0]} />
        <Emissive color={color} emissiveIntensity={1.1} />
      </mesh>
    </group>
  );
}

function AegisVirus({ color }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.38, 0.32, 0.12, 6]} />
        <Emissive color={color} emissiveIntensity={0.65} metalness={0.5} />
      </mesh>
      {Array.from({ length: 6 }, (_, i) => {
        const a = (i / 6) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(a) * 0.4, 0.55, Math.sin(a) * 0.18]}
            rotation={[0.4, a, 0]}
          >
            <coneGeometry args={[0.05, 0.22, 5]} />
            <Emissive color={color} emissiveIntensity={0.95} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.55, 0.08]}>
        <octahedronGeometry args={[0.14, 0]} />
        <Emissive color="#ecfeff" emissiveIntensity={0.9} />
      </mesh>
    </group>
  );
}

const VIRUS_BODIES = {
  shade: ShadeVirus,
  static: StaticVirus,
  mettaur: MettaurVirus,
  halo: HaloVirus,
  aegis: AegisVirus,
};

export function VirusFigure({ model, col = 4, row = 1, flinch = 0, hpRatio = 1 }) {
  const group = useSmoothPanel(col, row);
  const inner = useRef(null);
  const color = model?.color || "#f87171";
  const Body = VIRUS_BODIES[model?.silhouette] || MettaurVirus;
  const dim = 0.45 + Math.max(0, Math.min(1, hpRatio)) * 0.55;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!inner.current) return;
    inner.current.position.y = 0.04 + Math.sin(t * 2.1) * 0.03;
    inner.current.rotation.y = Math.PI + Math.sin(t * 0.8) * 0.08;
    const hit = flinch > 0 ? Math.sin(t * 48) * 0.05 : 0;
    inner.current.position.x = hit;
  });

  return (
    <group ref={group}>
      <group ref={inner} scale={dim}>
        <pointLight color={color} intensity={0.9} distance={2.8} />
        <Body color={color} />
      </group>
    </group>
  );
}

export function BattleProjectile({ col, row, color, kind }) {
  const mesh = useRef(null);
  const spawn = figureWorldPosition(col, row);
  const target = useRef(new THREE.Vector3(spawn[0], spawn[1] + 0.55, spawn[2]));
  const ready = useRef(false);

  useEffect(() => {
    const [x, y, z] = figureWorldPosition(col, row);
    target.current.set(x, y + 0.55, z);
  }, [col, row]);

  useFrame((_, dt) => {
    if (!mesh.current) return;
    if (!ready.current) {
      mesh.current.position.copy(target.current);
      ready.current = true;
      return;
    }
    mesh.current.position.lerp(target.current, 1 - Math.pow(0.0004, dt));
    mesh.current.rotation.x += dt * 8;
  });

  const slash = kind === "slash";
  return (
    <mesh ref={mesh}>
      {slash ? <boxGeometry args={[0.85, 0.06, 0.18]} /> : <sphereGeometry args={[0.12, 12, 10]} />}
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={1.6}
        toneMapped={false}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

export function BattleNaviPreview({ model }) {
  return <SerenityFigure model={model} anchored col={1} row={1} facing={1} hpRatio={1} />;
}
