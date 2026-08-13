import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import {
  ContactShadows,
  Float,
  OrbitControls,
  Sparkles,
  Stars,
} from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import TesseractLattice from "@/components/battle/TesseractLattice";
import AnimaVesselMesh from "@/components/anima/AnimaVesselMesh";

function VesselStage({ model, autoRotate }) {
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
      <Stars radius={30} depth={20} count={1100} factor={2.5} saturation={0.25} fade speed={0.5} />
      <Sparkles
        count={90}
        scale={[3.8, 5.2, 3.8]}
        size={1.9}
        speed={0.32}
        color={color}
        opacity={0.72}
      />
      <TesseractLattice color={color} scale={2.05} speed={0.5} opacity={0.26} position={[0, 0.85, 0]} />
      <Float speed={1.15} rotationIntensity={0.14} floatIntensity={0.24}>
        <group position={[0, -0.35, 0]} scale={1.05}>
          <AnimaVesselMesh model={model} hd hpRatio={1} facing={1} showLattice />
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
        autoRotate={autoRotate}
        autoRotateSpeed={0.48}
        enableDamping
        dampingFactor={0.08}
      />
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom
          intensity={1.05}
          luminanceThreshold={0.16}
          luminanceSmoothing={0.3}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

/**
 * Interactive HD 4D Anima vessel — full-body coherent form.
 * Drag to turn, scroll/pinch to zoom.
 */
export default function AnimaVessel4D({
  model,
  className,
  autoRotate = true,
  dprMax = 2,
}) {
  const style = useMemo(
    () => ({ width: "100%", height: "100%", display: "block", background: "#03040c" }),
    [],
  );

  return (
    <div className={`touch-none ${className || ""}`} style={{ width: "100%", height: "100%", position: "relative" }}>
      <Canvas
        camera={{ position: [0.65, 1.55, 2.85], fov: 32, near: 0.08, far: 45 }}
        gl={{ alpha: false, antialias: true, powerPreference: "high-performance" }}
        dpr={[1, dprMax]}
        style={style}
        onCreated={({ camera, gl }) => {
          camera.lookAt(0, 0.75, 0);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.22;
        }}
      >
        <VesselStage model={model} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}
