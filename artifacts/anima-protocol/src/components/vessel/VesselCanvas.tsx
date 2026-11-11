/**
 * Performance-aware host for VesselModel.
 * - portrait: tiny, dpr 1, demand frameloop ticked at ~12fps while visible
 * - full: frameloop="demand" by default. It renders continuously only while
 *   the user drags, the companion speaks, a clip plays, or a pulse (emotion
 *   shift, mood change, model load, pointer move) is running; at rest a gentle
 *   idle tick (breathing, blink) keeps it alive at IDLE_FPS, and under
 *   prefers-reduced-motion it holds a single static frame. Adaptive DPR via
 *   PerformanceMonitor only while the loop is running; paused offscreen/hidden.
 * - snapshot: renders and reads the frame in the same task, so the drawing
 *   buffer never needs preserveDrawingBuffer.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import type { WebGLRenderer } from "three";
import type { VesselShift } from "@/lib/vessel/emotionShift";
import VesselModel from "./VesselModel";
import type { VesselConfig } from "@/lib/vessel/vesselConfig";
import type { Expression } from "@/lib/vessel/emotion";
import type { ArkitFaceWeights } from "@/lib/vessel/arkitFace";
import { useFrameloopGate } from "@/hooks/useFrameloopGate";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import type { FrameloopGate } from "@/lib/vessel/frameloopGate";
import { RenderDemandContext, type RenderDemand } from "./renderDemand";
import { detectRendererCapabilities, selectRendererQuality } from "@/lib/rendererQuality";
import { isLifelikeModel } from "@/lib/vessel/lifelikeBase";
import LifelikeStage from "./LifelikeStage";

/** Idle (nothing moving but breathing/blink) render rate for full mode. */
export const IDLE_FPS = 15;
/** How long a prop change (emotion tick, mood, morph override) keeps the loop running. */
export const CHANGE_PULSE_MS = 1200;
const POINTER_PULSE_MS = 800;
const LOAD_PULSE_MS = 1000;

export type VesselCanvasHandle = { snapshot: (type?: string, quality?: number) => string | null };

type Props = {
  config: VesselConfig;
  expression: Expression;
  mode?: "portrait" | "full";
  hd?: boolean;
  className?: string;
  shift?: VesselShift | null;
  /** Chat mood + intensity for VRM expression presets (uploaded VRM vessels). */
  mood?: string | null;
  intensity?: number;
  /** Companion voice is playing: VRM lip-sync. */
  speaking?: boolean;
  /** Full mode framing: whole body (default) or a head close-up (face work). Read at mount. */
  focus?: "body" | "head";
  /** Dev/lab: pin ARKit face morph weights on plain GLB vessels. */
  faceOverride?: ArkitFaceWeights | null;
};

function useVisible(ref: React.RefObject<HTMLElement | null>) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let inView = true;
    const update = () => setVisible(inView && document.visibilityState === "visible");
    const io = new IntersectionObserver(([e]) => {
      inView = e.isIntersecting;
      update();
    });
    io.observe(el);
    document.addEventListener("visibilitychange", update);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);
  return visible;
}

function Ticker({ fps, active }: { fps: number; active: boolean }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => invalidate(), 1000 / fps);
    return () => window.clearInterval(id);
  }, [fps, active, invalidate]);
  return null;
}

function GlGrabber({ onGl }: { onGl: (gl: WebGLRenderer, render: () => void) => void }) {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    onGl(gl, () => gl.render(scene, camera));
  }, [gl, scene, camera, onGl]);
  return null;
}

/** Wakes the demand loop whenever the gate flips (and once on mount / model load). */
function DemandBridge({ gate }: { gate: FrameloopGate }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    invalidate();
    return gate.subscribe(() => invalidate());
  }, [gate, invalidate]);
  return null;
}

const VesselCanvas = forwardRef<VesselCanvasHandle, Props>(function VesselCanvas(
  { config, expression, mode = "full", hd = false, className, shift = null, mood, intensity, speaking = false, focus = "body", faceOverride = null },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const visible = useVisible(host);
  const glRef = useRef<{ gl: WebGLRenderer; render: () => void } | null>(null);
  // Stable + returns nothing: an effect that returns the assignment's object makes React call it as a cleanup and crash.
  const onGl = useCallback((gl: WebGLRenderer, render: () => void) => {
    glRef.current = { gl, render };
  }, []);
  // Same device tiers as Presence / NetBattle: the ceiling caps DPR and antialiasing.
  const tier = useMemo(() => selectRendererQuality(detectRendererCapabilities()), []);
  const maxDpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, hd ? 2 : 1.5, tier.dpr[1]) : 1;
  const [dpr, setDpr] = useState(mode === "portrait" ? 1 : Math.min(1.25, maxDpr));
  const portrait = mode === "portrait";
  const head = !portrait && focus === "head";
  const reduced = usePrefersReducedMotion();
  // Lifelike bases (20 MB GLB, physical skin, HDRI) are a Studio / presence-view thing:
  // tiny portraits keep the light procedural body.
  const lifelike = !portrait && isLifelikeModel(config.model);
  const shownConfig = useMemo<VesselConfig>(
    () => (portrait && isLifelikeModel(config.model) ? { ...config, model: { kind: "procedural" } } : config),
    [portrait, config],
  );
  const { gate, frameloop, active } = useFrameloopGate(visible);
  const demand = useMemo<RenderDemand>(
    () => ({
      pulse: (ms) => gate.pulse(reduced ? Math.min(ms, 120) : ms),
      hold: (key) => (reduced ? gate.pulse(120) : gate.hold(key)),
      release: (key) => gate.release(key),
    }),
    [gate, reduced],
  );

  // Emotion-shift ticks, mood/expression changes, morph overrides and config edits
  // animate for a moment (eased weights, aura); render through it, then rest.
  useEffect(() => {
    if (!portrait) demand.pulse(CHANGE_PULSE_MS);
  }, [portrait, demand, shift, expression, mood, intensity, faceOverride, config]);
  // Live speech (jaw / visemes) keeps the loop running for its whole duration.
  useEffect(() => {
    if (portrait || !speaking) return;
    demand.hold("speaking");
    return () => demand.release("speaking");
  }, [portrait, speaking, demand]);

  useImperativeHandle(ref, () => ({
    snapshot: (type = "image/jpeg", quality = 0.9) => {
      const g = glRef.current;
      if (!g) return null;
      // Same task as the render: the buffer is still intact without preserveDrawingBuffer.
      g.render();
      return g.gl.domElement.toDataURL(type, quality);
    },
  }));

  return (
    <div
      ref={host}
      className={className}
      data-frameloop={portrait ? (visible ? "demand" : "never") : frameloop}
      onPointerMove={portrait || reduced ? undefined : () => gate.pulse(POINTER_PULSE_MS)}
    >
      <Canvas
        dpr={dpr}
        frameloop={portrait ? (visible ? "demand" : "never") : frameloop}
        camera={{ position: portrait ? [0, 1.55, 0.75] : head ? [0, 1.6, 0.7] : [0, 1.2, 2.6], fov: portrait ? 30 : head ? 30 : 40 }}
        gl={{ antialias: !portrait && hd && tier.antialias, powerPreference: "low-power", preserveDrawingBuffer: false, alpha: true }}
      >
        <RenderDemandContext.Provider value={demand}>
        {lifelike ? (
          <LifelikeStage tier={tier} hd={hd} rim={config.effects.color} reducedMotion={reduced} />
        ) : (
          <>
            <ambientLight intensity={0.6} />
            <directionalLight position={[1.5, 3, 2]} intensity={1.1} />
            <pointLight position={[-1.5, 1.6, 1]} intensity={0.6} color={config.effects.color} />
          </>
        )}
        <VesselModel config={shownConfig} expression={expression} hd={hd && !portrait} track={!portrait} shift={shift} mood={mood} intensity={intensity} speaking={speaking} faceOverride={faceOverride} reducedMotion={reduced} onLoaded={() => demand.pulse(LOAD_PULSE_MS)} />
        {portrait ? (
          <Ticker fps={speaking && config.model.kind === "vrm" ? 24 : 12} active={visible} />
        ) : (
          <>
            {/* fps sampling is only meaningful while the loop runs continuously */}
            {active && (
              <PerformanceMonitor
                onIncline={() => setDpr((d) => Math.min(maxDpr, d + 0.25))}
                onDecline={() => setDpr((d) => Math.max(0.75, d - 0.25))}
                flipflops={3}
                onFallback={() => setDpr(0.75)}
              />
            )}
            <OrbitControls
              target={head ? [0, 1.6, 0] : [0, 1.1, 0]}
              enablePan={false}
              minDistance={head ? 0.35 : 1}
              maxDistance={4}
              enableDamping={!reduced}
              onStart={() => gate.hold("drag")}
              onEnd={() => {
                gate.release("drag");
                if (!reduced) gate.pulse(POINTER_PULSE_MS); // damping settle
              }}
            />
            <DemandBridge gate={gate} />
            <Ticker fps={IDLE_FPS} active={visible && !active && !reduced} />
            <GlGrabber onGl={onGl} />
          </>
        )}
        </RenderDemandContext.Provider>
      </Canvas>
    </div>
  );
});

export default VesselCanvas;
