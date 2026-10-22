/**
 * Scan view: MMBN-style grid, instanced signal beacons (strength from the tuner,
 * glitch for hostile/noise), holographic vessel projections for the strongest
 * persona-backed nodes (LOD-capped), map (touch orbit/pan) or AR-ish heading mode.
 */
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import * as THREE from "three";
import VesselModel from "@/components/vessel/VesselModel";
import { defaultVesselFor, type VesselConfig } from "@/lib/vessel/vesselConfig";
import { expressionFor } from "@/lib/vessel/emotion";
import { bandOf, signalStrength } from "@/lib/resonance/tuning";
import type { ResonanceNode } from "@/lib/resonance/resonanceApi";
import { makeBeaconMaterial, makeGridMaterial } from "./shaders";

export type SceneNode = ResonanceNode & { displayName: string; vessel?: VesselConfig | null };

type Props = {
  nodes: SceneNode[];
  tuned: number;
  width: number;
  mode: "map" | "ar";
  orientation: MutableRefObject<{ alpha: number; beta: number; gamma: number }>;
  selectedId?: string | null;
  onSelect: (node: SceneNode, strength: number) => void;
  hd?: boolean;
};

function Grid() {
  const mat = useMemo(() => makeGridMaterial(), []);
  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime));
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} material={mat}>
      <planeGeometry args={[40, 40, 1, 1]} />
    </mesh>
  );
}

function Beacons({ nodes, strengths, onSelect, selectedId }: { nodes: SceneNode[]; strengths: number[]; onSelect: Props["onSelect"]; selectedId?: string | null }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const mat = useMemo(() => makeBeaconMaterial(), []);
  const geo = useMemo(() => {
    const g = new THREE.OctahedronGeometry(0.35, 0);
    g.scale(1, 2.4, 1);
    g.translate(0, 1.1, 0);
    return g;
  }, []);
  const count = nodes.length;

  useEffect(() => {
    const m = mesh.current;
    if (!m) return;
    const colors = new Float32Array(count * 3);
    const strength = new Float32Array(count);
    const glitch = new Float32Array(count);
    const tmp = new THREE.Object3D();
    const c = new THREE.Color();
    nodes.forEach((n, i) => {
      const s = strengths[i];
      tmp.position.set(n.position.x, n.position.y, n.position.z);
      const scale = (n.is_signature ? 1.4 : 1) * (n.id === selectedId ? 1.25 : 1) * (0.6 + s * 0.4);
      tmp.scale.setScalar(scale);
      tmp.updateMatrix();
      m.setMatrixAt(i, tmp.matrix);
      c.set(n.signal_type === "hostile" ? "#ef4444" : n.signal_type === "noise" ? "#94a3b8" : bandOf(n.frequency).color);
      colors.set([c.r, c.g, c.b], i * 3);
      strength[i] = s;
      glitch[i] = n.signal_type === "hostile" ? 0.8 : n.signal_type === "noise" ? 1 : (1 - s) * 0.3;
    });
    geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
    geo.setAttribute("aStrength", new THREE.InstancedBufferAttribute(strength, 1));
    geo.setAttribute("aGlitch", new THREE.InstancedBufferAttribute(glitch, 1));
    m.instanceMatrix.needsUpdate = true;
    m.computeBoundingSphere();
  }, [nodes, strengths, selectedId, count, geo]);

  useFrame(({ clock }) => (mat.uniforms.uTime.value = clock.elapsedTime));

  const click = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.instanceId == null) return;
    onSelect(nodes[e.instanceId], strengths[e.instanceId]);
  };

  if (!count) return null;
  return <instancedMesh key={count} ref={mesh} args={[geo, mat, count]} onClick={click} frustumCulled={false} />;
}

function Holograms({ nodes, strengths, max }: { nodes: SceneNode[]; strengths: number[]; max: number }) {
  const picks = useMemo(
    () =>
      nodes
        .map((n, i) => ({ n, s: strengths[i] }))
        .filter((x) => x.s >= 0.45 && (x.n.signal_type === "companion" || x.n.signal_type === "benign" || x.n.is_signature))
        .sort((a, b) => b.s - a.s)
        .slice(0, max),
    [nodes, strengths, max],
  );
  const expr = useMemo(() => expressionFor("neutral", 40), []);
  return (
    <>
      {picks.map(({ n, s }) => (
        <group key={n.id} position={[n.position.x + 0.7, 0, n.position.z]} scale={0.55 + s * 0.25}>
          <VesselModel config={n.vessel || defaultVesselFor({ name: n.displayName })} expression={expr} hologram track={false} />
        </group>
      ))}
    </>
  );
}

function ArCamera({ orientation }: { orientation: Props["orientation"] }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(0, 1.6, 0);
  }, [camera]);
  useFrame(() => {
    const { alpha, beta } = orientation.current;
    const yaw = THREE.MathUtils.degToRad(alpha);
    const pitch = THREE.MathUtils.degToRad(Math.max(-10, Math.min(170, beta)) - 90);
    camera.rotation.set(pitch, yaw, 0, "YXZ");
  });
  return null;
}

export default function ResonanceScene({ nodes, tuned, width, mode, orientation, selectedId, onSelect, hd }: Props) {
  const maxDpr = Math.min(typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1, hd ? 2 : 1.5);
  const [dpr, setDpr] = useState(Math.min(1.25, maxDpr));
  const strengths = useMemo(() => nodes.map((n) => signalStrength(n.frequency, tuned, width)), [nodes, tuned, width]);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const f = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", f);
    return () => document.removeEventListener("visibilitychange", f);
  }, []);

  return (
    <Canvas
      dpr={dpr}
      frameloop={visible ? "always" : "never"}
      camera={{ position: [0, 9, 12], fov: 55 }}
      gl={{ antialias: !!hd, powerPreference: "high-performance", alpha: false }}
    >
      <color attach="background" args={["#020617"]} />
      <fog attach="fog" args={["#020617", 12, 30]} />
      <ambientLight intensity={0.5} />
      <Grid />
      <Beacons nodes={nodes} strengths={strengths} onSelect={onSelect} selectedId={selectedId} />
      <Holograms nodes={nodes} strengths={strengths} max={hd ? 5 : 3} />
      {mode === "ar" ? <ArCamera orientation={orientation} /> : <OrbitControls enableDamping maxPolarAngle={Math.PI / 2.1} minDistance={4} maxDistance={24} />}
      <PerformanceMonitor
        onIncline={() => setDpr((d) => Math.min(maxDpr, d + 0.25))}
        onDecline={() => setDpr((d) => Math.max(0.6, d - 0.25))}
        flipflops={3}
        onFallback={() => setDpr(0.6)}
      />
    </Canvas>
  );
}
