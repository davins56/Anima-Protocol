/**
 * R3F scene for the immersive sim. Owns the per-frame driver that feeds real
 * time into the fixed-step loop (before anything else renders that frame),
 * the W-following camera, band-driven atmosphere/post FX, the five layer
 * arenas, units and consequence FX.
 */
import { memo, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { PerformanceMonitor, Sparkles, Stars } from "@react-three/drei";
import { Bloom, ChromaticAberration, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";
import * as THREE from "three";
import { BANDS, clarityAt, layerAt, type SimState } from "@workspace/sim-core";
import { spectrumColorAt } from "@/styles/anima-tokens";
import { useRendererQuality } from "@/hooks/useRendererQuality";
import { unitPose } from "@/lib/simClient/wSpace";
import type { FixedStepLoop } from "@/lib/simClient/fixedStepLoop";
import { SimLayerArena, ResonanceTapHandler, type PanelMarks } from "./SimArena3D";
import { SimNavi, SimVirus } from "./SimUnits3D";
import { localToWorld } from "./simSpace3D";
import { SimFxLayer, WLattice } from "./SimFx3D";
import { useFx, useLoopState, type SimFxStore } from "./simStore";

/** Steps the simulation from render time. Negative priority: runs before every other useFrame. */
function LoopDriver({ loop }: { loop: FixedStepLoop }) {
  useFrame((_, delta) => {
    loop.update(delta * 1000);
  }, -10);
  return null;
}

/** Camera slides along W with the navi (critically-damped follow), FOV kicks mid-shift. */
function WCamera({ loop, animate }: { loop: FixedStepLoop; animate: boolean }) {
  const scratch = useRef({ target: new THREE.Vector3(), look: new THREE.Vector3(0, 0.42, 0), desired: new THREE.Vector3() });
  useFrame((state, dt) => {
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, "navi");
    if (!pose) return;
    const { target, look, desired } = scratch.current;
    const camera = state.camera as THREE.PerspectiveCamera;
    const sway = animate ? Math.sin(state.clock.elapsedTime * 0.07) * 0.42 : 0;
    // Rig is defined in arena-local space and carried around the W ring.
    localToWorld([sway, 5.85, 7.55], pose.planeW, desired);
    localToWorld([0, 0.42, 0], pose.planeW, target);
    const k = 1 - Math.exp(-6 * Math.min(dt, 0.1));
    camera.position.lerp(desired, k);
    look.lerp(target, k);
    camera.lookAt(look);
    const fov = 34 + pose.dissolve * 7;
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }
  });
  return null;
}

type Atmos = { fog: THREE.Fog; bg: THREE.Color; band: THREE.Color; bloom: any; noise: any; chroma: any };

/**
 * Band colour + clarity of the navi's current W drive fog, background, bloom,
 * film noise and chromatic aberration; a memory corruption spikes the glitch.
 */
function BandAtmosphere({ loop, glitchUntil, post }: { loop: FixedStepLoop; glitchUntil: React.MutableRefObject<number>; post: boolean }) {
  const fx = useRef<Atmos>({ fog: new THREE.Fog("#02010a", 9, 26), bg: new THREE.Color("#02010a"), band: new THREE.Color(), bloom: null, noise: null, chroma: null });
  const hemi = useRef<THREE.HemisphereLight>(null);
  const chromaOffset = useMemo(() => new THREE.Vector2(0.0007, 0.0005), []);
  useFrame((state) => {
    const pose = unitPose(loop.prev, loop.curr, loop.alpha, "navi");
    if (!pose) return;
    const a = fx.current;
    const clarity = clarityAt(pose.w);
    const noise = 1 - clarity;
    a.band.set(spectrumColorAt(pose.w));
    a.fog.color.set("#02010a").lerp(a.band, 0.035 + noise * 0.05);
    a.fog.near = 9 + clarity * 3;
    a.fog.far = 18 + clarity * 14;
    a.bg.copy(a.fog.color);
    state.scene.fog = a.fog;
    state.scene.background = a.bg;
    if (hemi.current) hemi.current.color.set("#67e8f9").lerp(a.band, 0.35);
    const glitch = Math.max(0, (glitchUntil.current - performance.now()) / 600);
    if (a.bloom) a.bloom.intensity = 0.45 + clarity * 0.9 + pose.dissolve * 0.6;
    if (a.noise?.blendMode?.opacity) a.noise.blendMode.opacity.value = Math.min(0.9, noise * 0.35 + glitch * 0.6);
    if (a.chroma?.offset) a.chroma.offset.set(0.0006 + noise * 0.002 + glitch * 0.012 + pose.dissolve * 0.003, 0.0004 + glitch * 0.006);
  });
  return (
    <>
      <ambientLight intensity={0.18} />
      <hemisphereLight ref={hemi} args={["#67e8f9", "#1e1020", 0.45]} />
      <directionalLight position={[4, 9, 5]} intensity={0.95} color="#e0f2fe" />
      {post ? (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom ref={(e: any) => void (fx.current.bloom = e)} intensity={0.9} luminanceThreshold={0.2} luminanceSmoothing={0.28} mipmapBlur />
          <ChromaticAberration ref={(e: any) => void (fx.current.chroma = e)} offset={chromaOffset} radialModulation modulationOffset={0.35} />
          <Noise ref={(e: any) => void (fx.current.noise = e)} opacity={0.1} premultiply />
          <Vignette darkness={0.55} offset={0.28} />
        </EffectComposer>
      ) : null}
    </>
  );
}

function telegraphMarks(s: SimState, layer: number): PanelMarks {
  const warn = new Map<string, number>();
  for (const u of s.units) {
    const t = u.telegraph;
    if (!t || u.hp <= 0) continue;
    const urgency = Math.min(1, Math.max(0.15, 1 - (t.at - s.tick) / 16));
    for (const c of t.cells) if (c.layer === layer) warn.set(`${c.col},${c.row}`, Math.max(urgency, warn.get(`${c.col},${c.row}`) ?? 0));
  }
  const portal = new Set<string>();
  for (const p of s.portals)
    for (const end of [p.a, p.b]) if (end.layer === layer) portal.add(`${end.col},${end.row}`);
  return { warn, portal };
}

type SceneProps = {
  loop: FixedStepLoop;
  fxStore: SimFxStore;
  model: Record<string, unknown>;
  quality: any;
  glitchUntil: React.MutableRefObject<number>;
  onPanelTap: (layer: number, col: number, row: number) => void;
  onNodeTap: (layer: number) => void;
};

function SimWorld({ loop, fxStore, model, quality, glitchUntil, onPanelTap, onNodeTap }: SceneProps) {
  const s = useLoopState(loop);
  const fx = useFx(fxStore);
  const navi = s.units[0];
  const activeLayer = layerAt(navi.phase ? navi.phase.toW : navi.w);
  const marks = useMemo(() => BANDS.map((_, l) => telegraphMarks(s, l)), [s]);
  const bandColor = spectrumColorAt(navi.w);
  const enemies = s.units.filter((u) => u.side === "enemy" && (u.hp > 0 || fxStore.defeatedAt.has(u.id)) && !(u.hp <= 0 && s.tick - (fxStore.defeatedAt.get(u.id) ?? 0) > 16));

  return (
    <>
      <LoopDriver loop={loop} />
      <WCamera loop={loop} animate={quality.animateCamera} />
      <BandAtmosphere loop={loop} glitchUntil={glitchUntil} post={quality.postprocessing} />
      <ResonanceTapHandler onNode={onNodeTap} />
      <Stars radius={48} depth={30} count={quality.stars} factor={2.8} saturation={0.2} fade speed={0.6} />
      {quality.sparkles > 0 ? <Sparkles count={quality.sparkles} scale={[10, 6, 30]} position={[0, 3, -12]} size={2} speed={0.3} color={bandColor} opacity={0.5} /> : null}
      {BANDS.map((b, l) => (
        <SimLayerArena key={b.key} layer={l} panels={s.panels[l]} marks={marks[l]} activeLayer={activeLayer} onPanelTap={onPanelTap} />
      ))}
      {quality.tesseracts >= 1 ? <WLattice loop={loop} color={bandColor} /> : null}
      <SimNavi loop={loop} fxStore={fxStore} navi={navi} model={model} quality={quality} />
      {enemies.map((u) => (
        <SimVirus key={u.id} loop={loop} fxStore={fxStore} unit={u} />
      ))}
      <SimFxLayer loop={loop} fx={fx} portals={s.portals} />
    </>
  );
}

export default memo(function SimScene3D(props: Omit<SceneProps, "quality">) {
  const { quality, handleDecline, handleIncline } = useRendererQuality();
  return (
    <Canvas
      camera={{ position: [0, 5.85, 7.55], fov: 34, near: 0.1, far: 80 }}
      gl={{ alpha: false, antialias: quality.antialias, powerPreference: "high-performance" }}
      dpr={quality.dpr}
      style={{ width: "100%", height: "100%", display: "block", background: "#02010a", touchAction: "none" }}
      onCreated={({ gl }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.16;
      }}
    >
      <PerformanceMonitor flipflops={3} onDecline={handleDecline} onIncline={handleIncline}>
        <SimWorld {...props} quality={quality} />
      </PerformanceMonitor>
    </Canvas>
  );
});
