/**
 * Emotion-driven aura shared by both vessel renderers (AnimaVesselMesh and
 * VesselModel). One InstancedMesh (single draw call) whose motion depends on
 * the companion's aura kind:
 *   flame     — embers rising from a flickering core (Scarlet)
 *   celestial — motes on tilted orbits (Serenity)
 *   verdant   — slow upward spiral (Aeland placeholder)
 * All intensities come from VesselShift; budget scales with renderer quality.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { VesselShift } from "@/lib/vessel/emotionShift";

type Props = { shift: VesselShift; budget?: number; height?: number };

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const v = new THREE.Vector3();
const sc = new THREE.Vector3();
const col = new THREE.Color();
const c2 = new THREE.Color();
const base = new THREE.Color();
const X_AXIS = new THREE.Vector3(1, 0, 0);

const hash = (i: number) => {
  const x = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

export default function VesselAura({ shift, budget = 48, height = 1.9 }: Props) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const core = useRef<THREE.Group>(null);
  const count = Math.max(0, Math.min(160, Math.round(budget)));
  const seeds = useMemo(() => Array.from({ length: count }, (_, i) => [hash(i), hash(i + 0.37), hash(i + 0.71)] as const), [count]);
  const clock = useRef(0);

  useFrame((_, dt) => {
    clock.current += dt * (0.4 + shift.particleRate);
    const t = clock.current;
    const m = mesh.current;
    const flick = (i: number) => (shift.flicker > 0 && Math.sin(t * 37 + i * 13.7) > 1 - shift.flicker * 0.6 ? 0 : 1);
    if (m) {
      base.set(shift.color);
      c2.set(shift.accent);
      for (let i = 0; i < count; i++) {
        const [a, b, c] = seeds[i];
        let x = 0, y = 0, z = 0, s = 0.02;
        if (shift.aura === "flame") {
          const life = (a + t * (0.35 + b * 0.4)) % 1;
          const r = (0.12 + 0.22 * (1 - life)) * shift.spread;
          const ang = c * Math.PI * 2 + life * 2;
          x = Math.cos(ang) * r;
          z = Math.sin(ang) * r * 0.7;
          y = 0.05 + life * height * 0.75 * shift.auraIntensity;
          s = (0.05 - life * 0.04) * (0.7 + shift.auraIntensity * 0.5);
          col.copy(c2).lerp(base, Math.min(1, life * 1.6));
        } else if (shift.aura === "celestial") {
          const ring = i % 3;
          const ang = a * Math.PI * 2 + t * (0.3 + ring * 0.15) * shift.haloSpin;
          const r = (0.45 + ring * 0.12) * shift.spread;
          v.set(Math.cos(ang) * r, 0, Math.sin(ang) * r).applyAxisAngle(X_AXIS, 0.35 + ring * 0.3);
          x = v.x; y = 1.05 + v.y + (b - 0.5) * 0.3; z = v.z;
          s = 0.012 + 0.014 * c;
          col.copy(base).lerp(c2, b * 0.6);
        } else if (shift.aura === "verdant") {
          const life = (a + t * 0.12) % 1;
          const ang = c * Math.PI * 2 + life * 5;
          const r = (0.3 + 0.15 * b) * shift.spread;
          x = Math.cos(ang) * r; z = Math.sin(ang) * r; y = life * height;
          s = 0.015 + 0.01 * b;
          col.copy(base).lerp(c2, life);
        } else {
          s = 0;
        }
        s *= flick(i) * Math.min(1.5, shift.auraIntensity + 0.2);
        m4.compose(v.set(x, y, z), q, sc.set(s, s, s));
        m.setMatrixAt(i, m4);
        m.setColorAt(i, col.multiplyScalar(0.6 + 0.4 * shift.glow));
      }
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    if (light.current) {
      const f = shift.aura === "flame" ? 0.75 + 0.25 * Math.sin(t * 23) * Math.sin(t * 7.3) : 1;
      light.current.intensity = shift.glow * shift.auraIntensity * 1.2 * f;
    }
    if (core.current) {
      const f = 1 + 0.12 * Math.sin(t * 19) + 0.06 * Math.sin(t * 41);
      core.current.scale.set(shift.spread, shift.auraIntensity * f, shift.spread);
    }
  });

  if (shift.aura === "none") return null;
  return (
    <group>
      <pointLight ref={light} color={shift.color} distance={3.2} position={[0, shift.aura === "flame" ? 0.5 : 1.1, 0.3]} />
      {count > 0 && (
        <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
          <icosahedronGeometry args={[1, 0]} />
          <meshBasicMaterial transparent opacity={0.85} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </instancedMesh>
      )}
      {shift.aura === "flame" && (
        <group ref={core}>
          {[0.32, 0.22].map((r, i) => (
            <mesh key={r} position={[0, 0.35 + i * 0.1, 0]}>
              <coneGeometry args={[r, 0.9 - i * 0.2, 12, 1, true]} />
              <meshBasicMaterial color={i ? shift.accent : shift.color} transparent opacity={0.18 + i * 0.1} blending={THREE.AdditiveBlending} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
