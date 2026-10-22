/**
 * R3F view of the 4D arena: five 6×3 Battle Network rooms stacked along W.
 *
 * Reuse (no duplicate avatar/virus pipelines):
 *  - navi = BattleFigures3D.SerenityFigure → AnimaVesselMesh, fed the
 *    companion's saved VesselConfig (lib/sim/vesselModel.ts)
 *  - on-layer viruses = BattleFigures3D.VirusFigure tinted by band + a node glyph
 *  - panel/figure placement = lib/battleLayout (same CELL/PANEL sizes as NetBattle)
 *  - quality tiers = useRendererQuality + PerformanceMonitor (as NetBattleScene3D)
 *
 * Perf (iPad Pro M4): one InstancedMesh for all 90 panels (per-instance colour,
 * no per-panel React nodes), off-layer entities drawn as cheap glyph ghosts,
 * frameloop "demand" when the battle is over/paused, DPR capped by quality.
 */
import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor, Stars } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { SerenityFigure, VirusFigure } from "@/components/battle/BattleFigures3D";
import { PANEL_SIZE, PANEL_THICKNESS, panelWorldPosition, figureWorldPosition } from "@/lib/battleLayout";
import { useRendererQuality } from "@/hooks/useRendererQuality";
import {
  BANDS,
  BAND_BY_KEY,
  COLS,
  LAYER_COUNT,
  LAYER_W,
  ROWS,
  bandAt,
  layerAt,
  signalReadout,
  type EmittedEvent,
  type SimState,
  type Unit,
} from "@/lib/sim/engine";
import BandGlyph from "./BandGlyph";
import { BandFlash, DissolveColumn } from "./PhaseShiftFx";
import type { BattleVesselModel } from "@/lib/sim/vesselModel";

export const LAYER_GAP = 2.6;

/** Continuous Y for a W value: layers sit at band centres, crossfaded between. */
export function layerY(w: number): number {
  if (w <= LAYER_W[0]) return 0;
  for (let i = 1; i < LAYER_COUNT; i++) {
    if (w <= LAYER_W[i]) return (i - 1 + (w - LAYER_W[i - 1]) / (LAYER_W[i] - LAYER_W[i - 1])) * LAYER_GAP;
  }
  return (LAYER_COUNT - 1) * LAYER_GAP;
}

function unitW(u: Unit, tick: number): number {
  if (!u.phase) return u.w;
  const t = Math.min(1, Math.max(0, (tick - u.phase.startTick) / Math.max(1, u.phase.landTick - u.phase.startTick)));
  return u.phase.fromW + (u.phase.toW - u.phase.fromW) * t;
}

const tmpM = new THREE.Matrix4();
const tmpC = new THREE.Color();
const KIND_TINT: Record<string, string> = { normal: "#0b1220", cracked: "#4b5563", holy: "#facc15", poison: "#6d28d9", broken: "#000000" };

function Panels({ state, focusW }: { state: SimState; focusW: number }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = LAYER_COUNT * ROWS * COLS;
  const telegraphed = useMemo(() => {
    const set = new Set<string>();
    for (const u of state.units) if (u.telegraph && u.hp > 0) for (const c of u.telegraph.cells) set.add(`${c.layer}:${c.col}:${c.row}`);
    return set;
  }, [state]);
  const portals = useMemo(() => {
    const set = new Set<string>();
    for (const p of state.portals) for (const c of [p.a, p.b]) set.add(`${c.layer}:${c.col}:${c.row}`);
    return set;
  }, [state.portals]);

  useFrame((st) => {
    const m = mesh.current;
    if (!m) return;
    const t = st.clock.elapsedTime;
    let i = 0;
    for (let l = 0; l < LAYER_COUNT; l++) {
      const y = l * LAYER_GAP;
      const near = Math.max(0, 1 - Math.abs(layerY(focusW) - y) / LAYER_GAP); // 1 on focus layer → 0 one layer away
      const band = BANDS[l].color;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++, i++) {
          const p = state.panels[l][r][c];
          const [x, , z] = panelWorldPosition(c, r);
          const s = p.kind === "broken" ? 0.0001 : 1;
          tmpM.makeScale(s, 1, s).setPosition(x, y, z);
          m.setMatrixAt(i, tmpM);
          const key = `${l}:${c}:${r}`;
          tmpC.set(KIND_TINT[p.kind] || KIND_TINT.normal).lerp(new THREE.Color(band), p.kind === "normal" ? 0.28 : 0.15);
          if (c >= 3 && p.kind === "normal") tmpC.lerp(new THREE.Color("#3f0a12"), 0.35);
          if (telegraphed.has(key) && Math.sin(t * 18) > 0) tmpC.set("#ef4444"); // attack warning blink
          if (portals.has(key)) tmpC.lerp(new THREE.Color(band), 0.5 + 0.5 * Math.sin(t * 6));
          tmpC.multiplyScalar(0.18 + 0.82 * near); // off-layer = ghosted
          m.setColorAt(i, tmpC);
        }
    }
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
  });

  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, count]} frustumCulled={false}>
      <boxGeometry args={[PANEL_SIZE, PANEL_THICKNESS, PANEL_SIZE]} />
      <meshStandardMaterial roughness={0.3} metalness={0.3} emissive="#ffffff" emissiveIntensity={0.06} toneMapped={false} />
    </instancedMesh>
  );
}

function CameraRig({ focusW }: { focusW: number }) {
  useFrame((st, dt) => {
    const y = layerY(focusW);
    const k = 1 - Math.pow(0.002, dt);
    st.camera.position.y += (y + 5.6 - st.camera.position.y) * k;
    st.camera.position.x += (0 - st.camera.position.x) * k;
    st.camera.position.z += (7.6 - st.camera.position.z) * k;
    st.camera.lookAt(0, y + 0.4, 0);
  });
  return null;
}

function PhaseFx({ unit, tick, color }: { unit: Unit; tick: number; color: string }) {
  const ph = unit.phase!;
  const progress = Math.min(1, Math.max(0, (tick - ph.startTick) / Math.max(1, ph.landTick - ph.startTick)));
  const [x, , z] = figureWorldPosition(unit.col, unit.row);
  const to = bandAt(ph.toW).color;
  return (
    <>
      <DissolveColumn color={color} progress={progress} out position={[x, layerY(ph.fromW) + 0.95, z]} />
      <DissolveColumn color={to} progress={progress} out={false} position={[x, layerY(ph.toW) + 0.95, z]} />
      {/* afterimage on the origin layer */}
      <BandGlyph band={bandAt(ph.fromW).key} opacity={0.5 * (1 - progress)} scale={1.4} position={[x, layerY(ph.fromW) + 0.9, z]} />
    </>
  );
}

function Scene({ state, fx, model, previewW, quality }: Props & { quality: ReturnType<typeof useRendererQuality>["quality"] }) {
  const navi = state.units[0];
  const sig = signalReadout(state);
  const naviW = unitW(navi, state.tick);
  const naviLayer = layerAt(naviW);
  const lastLanding = useMemo(() => [...fx].reverse().find((e) => e.type === "phase_landed" && e.unitId === navi.id), [fx, navi.id]);
  const landAt = useRef<{ seq: number; at: number }>({ seq: -1, at: 0 });
  if (lastLanding && lastLanding.seq !== landAt.current.seq) landAt.current = { seq: lastLanding.seq, at: performance.now() };
  const [nx, , nz] = figureWorldPosition(navi.col, navi.row);

  return (
    <>
      <color attach="background" args={["#05030d"]} />
      <fog attach="fog" args={["#05030d", 8, 22]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[4, 9, 5]} intensity={0.9} color="#e0e7ff" />
      <hemisphereLight args={[sig.band.color, "#0b0614", 0.35 + 0.25 * sig.clarity]} />
      <Stars radius={40} depth={24} count={Math.min(quality.stars, 1200)} factor={2.4} saturation={0.2} fade speed={0.4} />
      <CameraRig focusW={naviW} />
      <Panels state={state} focusW={naviW} />

      {/* navi: the companion's vessel, on the shared AnimaVesselMesh renderer */}
      {(!navi.phase || Math.abs((state.tick - navi.phase.startTick) / Math.max(1, navi.phase.landTick - navi.phase.startTick) - 0.5) > 0.2) && (
        <group position={[0, layerY(naviW), 0]}>
          <SerenityFigure model={model} col={navi.col} row={navi.row} hpRatio={navi.hp / navi.maxHp} facing={1} quality={quality} expression={sig.clarity} />
        </group>
      )}
      {navi.phase && <PhaseFx unit={navi} tick={state.tick} color={sig.band.color} />}
      <BandFlash color={bandAt(navi.w).color} at={landAt.current.at} position={[nx, layerY(navi.w) + 1, nz]} />

      {/* ghost preview of where a phase-shift would land */}
      {previewW !== null && Math.abs(previewW - navi.w) >= 0.5 && !navi.phase && (
        <group position={[nx, layerY(previewW) + 0.1, nz]}>
          <mesh rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.32, 0.46, 32]} />
            <meshBasicMaterial color={bandAt(previewW).color} transparent opacity={0.7} depthWrite={false} toneMapped={false} />
          </mesh>
          <BandGlyph band={bandAt(previewW).key} opacity={0.45} scale={1.6} position={[0, 0.9, 0]} />
        </group>
      )}

      {state.units.slice(1).filter((u) => u.hp > 0).map((u) => {
        const w = unitW(u, state.tick);
        const onLayer = !u.phase && layerAt(w) === naviLayer;
        const [x, , z] = figureWorldPosition(u.col, u.row);
        const color = BAND_BY_KEY[u.band].color;
        return onLayer ? (
          <group key={u.id} position={[0, layerY(w), 0]}>
            <VirusFigure model={{ color, silhouette: u.kind }} col={u.col} row={u.row} hpRatio={u.hp / u.maxHp} />
            <BandGlyph band={u.band} scale={0.9} position={[x, 1.55, z]} />
          </group>
        ) : (
          // off-layer: translucent glyph ghost so threats on other W layers stay readable
          <BandGlyph key={u.id} band={u.band} opacity={0.28} scale={1.3} position={[x, layerY(w) + 0.8, z]} />
        );
      })}

      {state.portals.map((p) => {
        const [x, , z] = figureWorldPosition(p.a.col, p.a.row);
        const ya = p.a.layer * LAYER_GAP, yb = p.b.layer * LAYER_GAP;
        return (
          <group key={p.id}>
            <mesh position={[x, (ya + yb) / 2 + 0.1, z]}>
              <cylinderGeometry args={[0.06, 0.06, Math.abs(yb - ya), 8, 1, true]} />
              <meshBasicMaterial color={BANDS[p.b.layer].color} transparent opacity={0.55} toneMapped={false} />
            </mesh>
            {[ya, yb].map((y) => (
              <mesh key={y} position={[x, y + 0.08, z]} rotation={[-Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.38, 0.03, 8, 32]} />
                <meshBasicMaterial color={BANDS[p.b.layer].color} toneMapped={false} />
              </mesh>
            ))}
          </group>
        );
      })}

      {quality.postprocessing && (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom intensity={0.8} luminanceThreshold={0.22} luminanceSmoothing={0.3} mipmapBlur />
        </EffectComposer>
      )}
    </>
  );
}

type Props = { state: SimState; fx: EmittedEvent[]; model: BattleVesselModel; previewW: number | null };

export default function SimArena3D(props: Props) {
  const { quality, handleDecline, handleIncline } = useRendererQuality();
  const running = !props.state.outcome && !props.state.custom.open;
  return (
    <Canvas
      frameloop={running ? "always" : "demand"}
      camera={{ position: [0, 5.6, 7.6], fov: 36, near: 0.1, far: 60 }}
      gl={{ alpha: false, antialias: quality.antialias, powerPreference: "high-performance" }}
      dpr={quality.dpr}
      style={{ width: "100%", height: "100%", display: "block", background: "#05030d" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.15;
      }}
    >
      <PerformanceMonitor flipflops={3} onDecline={handleDecline} onIncline={handleIncline}>
        <Scene {...props} quality={quality} />
      </PerformanceMonitor>
    </Canvas>
  );
}
