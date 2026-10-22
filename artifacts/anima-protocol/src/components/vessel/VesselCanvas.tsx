/**
 * Performance-aware host for VesselModel.
 * - portrait: tiny, dpr 1, demand frameloop ticked at ~12fps while visible
 * - full: adaptive DPR via PerformanceMonitor, HD toggle, pause when offscreen/hidden
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls, PerformanceMonitor } from "@react-three/drei";
import type { WebGLRenderer } from "three";
import VesselModel from "./VesselModel";
import type { VesselConfig } from "@/lib/vessel/vesselConfig";
import type { Expression } from "@/lib/vessel/emotion";

export type VesselCanvasHandle = { snapshot: (type?: string, quality?: number) => string | null };

type Props = {
  config: VesselConfig;
  expression: Expression;
  mode?: "portrait" | "full";
  hd?: boolean;
  className?: string;
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
  useEffect(() => onGl(gl, () => gl.render(scene, camera)), [gl, scene, camera, onGl]);
  return null;
}

const VesselCanvas = forwardRef<VesselCanvasHandle, Props>(function VesselCanvas(
  { config, expression, mode = "full", hd = false, className },
  ref,
) {
  const host = useRef<HTMLDivElement>(null);
  const visible = useVisible(host);
  const glRef = useRef<{ gl: WebGLRenderer; render: () => void } | null>(null);
  const maxDpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, hd ? 2 : 1.5) : 1;
  const [dpr, setDpr] = useState(mode === "portrait" ? 1 : Math.min(1.25, maxDpr));
  const portrait = mode === "portrait";

  useImperativeHandle(ref, () => ({
    snapshot: (type = "image/jpeg", quality = 0.9) => {
      const g = glRef.current;
      if (!g) return null;
      g.render();
      return g.gl.domElement.toDataURL(type, quality);
    },
  }));

  return (
    <div ref={host} className={className}>
      <Canvas
        dpr={dpr}
        frameloop={!visible ? "never" : portrait ? "demand" : "always"}
        camera={{ position: portrait ? [0, 1.55, 0.75] : [0, 1.2, 2.6], fov: portrait ? 30 : 40 }}
        gl={{ antialias: !portrait && hd, powerPreference: "low-power", preserveDrawingBuffer: !portrait, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[1.5, 3, 2]} intensity={1.1} />
        <pointLight position={[-1.5, 1.6, 1]} intensity={0.6} color={config.effects.color} />
        <VesselModel config={config} expression={expression} hd={hd && !portrait} track={!portrait} />
        {portrait ? (
          <Ticker fps={12} active={visible} />
        ) : (
          <>
            <PerformanceMonitor
              onIncline={() => setDpr((d) => Math.min(maxDpr, d + 0.25))}
              onDecline={() => setDpr((d) => Math.max(0.75, d - 0.25))}
              flipflops={3}
              onFallback={() => setDpr(0.75)}
            />
            <OrbitControls target={[0, 1.1, 0]} enablePan={false} minDistance={1} maxDistance={4} />
            <GlGrabber onGl={(gl, render) => (glRef.current = { gl, render })} />
          </>
        )}
      </Canvas>
    </div>
  );
});

export default VesselCanvas;
