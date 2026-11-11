/**
 * Sideways W move = phase-shift: the navi dissolves out of the origin layer
 * (noise-threshold shader), an afterimage glyph lingers, the destination
 * column materialises in the target band colour, and a band-colour flash
 * fires on landing. Timings come from the engine's phase landTick so the
 * telegraph is exactly as long as the shift.
 */
import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const vert = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const frag = /* glsl */ `
  uniform float uProgress; uniform vec3 uColor; uniform float uTime; uniform float uOut;
  varying vec2 vUv;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  void main() {
    vec2 cell = floor(vUv * vec2(10.0, 28.0) + vec2(0.0, uTime * 6.0));
    float n = h(cell);
    float p = uOut > 0.5 ? uProgress : 1.0 - uProgress;   // out: grow holes; in: fill
    if (n < p) discard;
    float edge = smoothstep(p, p + 0.08, n);
    float scan = 0.55 + 0.45 * sin(vUv.y * 60.0 - uTime * 14.0);
    gl_FragColor = vec4(mix(vec3(1.0), uColor, edge), (1.0 - p) * 0.75 * scan);
  }
`;

export function DissolveColumn({ color, progress, out, position }: { color: string; progress: number; out: boolean; position: [number, number, number] }) {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({ uProgress: { value: 0 }, uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uOut: { value: out ? 1 : 0 } }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  uniforms.uColor.value.set(color);
  uniforms.uOut.value = out ? 1 : 0;
  useFrame((st) => {
    uniforms.uTime.value = st.clock.elapsedTime;
    uniforms.uProgress.value = progress;
  });
  return (
    <mesh position={position}>
      <cylinderGeometry args={[0.42, 0.42, 1.9, 24, 1, true]} />
      <shaderMaterial ref={mat} vertexShader={vert} fragmentShader={frag} uniforms={uniforms} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
    </mesh>
  );
}

/** Short band-colour light pulse at the landing point. */
export function BandFlash({ color, at, position }: { color: string; at: number; position: [number, number, number] }) {
  const light = useRef<THREE.PointLight>(null);
  useFrame(() => {
    if (!light.current) return;
    const age = (performance.now() - at) / 1000;
    light.current.intensity = age < 0 ? 0 : Math.max(0, 6 * (1 - age / 0.45));
  });
  return <pointLight ref={light} color={color} distance={4} position={position} intensity={0} />;
}
