import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Float,
  OrbitControls,
  PerformanceMonitor,
  Sparkles,
  Stars,
} from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import TesseractLattice from "@/components/battle/TesseractLattice";
import AnimaVesselMesh from "@/components/anima/AnimaVesselMesh";
import { useRendererQuality } from "@/hooks/useRendererQuality";

function VesselStage({ model, autoRotate, quality, expression, layers, sequences }) {
  const color = model?.color || "#67e8f9";
  const accent = model?.accent || "#c4b5fd";

  return (
    <>
      <color attach="background" args={["#03040c"]} />
      <fog attach="fog" args={["#03040c", 6.5, 18]} />
      <ambientLight intensity={0.16} />
      <hemisphereLight args={[color, "#12081c", 0.42]} />
      <directionalLight position={[3.2, 5.4, 3.8]} intensity={1.2} color="#f8fafc" />
      <directionalLight position={[-3.2, 2.2, -2.2]} intensity={0.5} color={accent} />
      <Stars
        radius={30}
        depth={20}
        count={quality.stars}
        factor={2.5}
        saturation={0.25}
        fade
        speed={0.5}
      />
      {quality.sparkles > 0 && (
        <Sparkles
          count={quality.sparkles}
          scale={[3.8, 5.2, 3.8]}
          size={1.9}
          speed={0.32}
          color={color}
          opacity={0.72}
        />
      )}
      {quality.tesseracts >= 1 && (
        <TesseractLattice
          color={color}
          scale={2.05}
          speed={0.5}
          opacity={0.26}
          position={[0, 0.85, 0]}
        />
      )}
      <Float speed={1.15} rotationIntensity={0.14} floatIntensity={0.24}>
        <group position={[0, -0.35, 0]} scale={1.05}>
          <AnimaVesselMesh
            model={model}
            quality={quality}
            hpRatio={1}
            facing={1}
            showLattice={quality.tesseracts >= 1}
            expression={expression}
            breathing
            layers={layers}
            sequences={sequences}
          />
        </group>
      </Float>
      <ContactShadows
        position={[0, -0.55, 0]}
        opacity={0.5}
        scale={7}
        blur={2.6}
        far={3.2}
        color="#02010a"
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={1.5}
        maxDistance={6.5}
        minPolarAngle={0.3}
        maxPolarAngle={Math.PI / 1.55}
        target={[0, 0.75, 0]}
        autoRotate={autoRotate && quality.animateCamera}
        autoRotateSpeed={0.48}
        enableDamping
        dampingFactor={0.08}
      />
      {quality.postprocessing && (
        <EffectComposer enableNormalPass={false} multisampling={0}>
          <Bloom
            intensity={1.05}
            luminanceThreshold={0.16}
            luminanceSmoothing={0.3}
            mipmapBlur
          />
        </EffectComposer>
      )}
    </>
  );
}

/**
 * Interactive Sovereign Presence stage — full-body 4D vessel with adaptive quality.
 */
export default function AnimaVessel4D({
  model,
  className,
  autoRotate = true,
  dprMax,
  expression = 0,
  layers,
  sequences,
}) {
  const { quality, handleDecline, handleIncline } = useRendererQuality();
  const dpr = dprMax != null ? [1, dprMax] : quality.dpr;

  const style = useMemo(
    () => ({ width: "100%", height: "100%", display: "block", background: "#03040c" }),
    [],
  );

  return (
    <div
      className={`touch-none ${className || ""}`}
      style={{ width: "100%", height: "100%", position: "relative" }}
      data-sovereign-presence
      data-quality={quality.name}
    >
      <Canvas
        camera={{ position: [0.65, 1.55, 2.85], fov: 32, near: 0.08, far: 45 }}
        gl={{
          alpha: false,
          antialias: quality.antialias,
          powerPreference: "high-performance",
        }}
        dpr={dpr}
        style={style}
        onCreated={({ camera, gl }) => {
          camera.lookAt(0, 0.75, 0);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.22;
        }}
      >
        <PerformanceMonitor flipflops={3} onDecline={handleDecline} onIncline={handleIncline}>
          <VesselStage
            model={model}
            autoRotate={autoRotate}
            quality={quality}
            expression={expression}
            layers={layers}
            sequences={sequences}
          />
        </PerformanceMonitor>
      </Canvas>
    </div>
  );
}
