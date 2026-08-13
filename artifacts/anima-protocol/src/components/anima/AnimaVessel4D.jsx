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
  const accent = model?.accent || "#fde68a";

  return (
    <>
      <color attach="background" args={["#03040c"]} />
      <fog attach="fog" args={["#03040c", 6, 16]} />
      <ambientLight intensity={0.18} />
      <hemisphereLight args={[color, "#12081c", 0.45]} />
      <directionalLight position={[3.2, 5.2, 3.6]} intensity={1.15} color="#f8fafc" />
      <directionalLight position={[-3, 2, -2]} intensity={0.45} color={accent} />
      <Stars radius={28} depth={18} count={900} factor={2.4} saturation={0.2} fade speed={0.55} />
      <Sparkles
        count={70}
        scale={[3.4, 4.2, 3.4]}
        size={1.8}
        speed={0.35}
        color={color}
        opacity={0.7}
      />
      <TesseractLattice color={color} scale={1.85} speed={0.55} opacity={0.28} position={[0, 0.7, 0]} />
      <Float speed={1.25} rotationIntensity={0.18} floatIntensity={0.28}>
        <group position={[0, -0.15, 0]} scale={1.15}>
          <AnimaVesselMesh model={model} hd hpRatio={1} facing={1} />
        </group>
      </Float>
      <ContactShadows
        position={[0, -0.05, 0]}
        opacity={0.45}
        scale={6}
        blur={2.4}
        far={2.8}
        color="#02010a"
      />
      <OrbitControls
        makeDefault
        enablePan={false}
        minDistance={1.35}
        maxDistance={5.8}
        minPolarAngle={0.35}
        maxPolarAngle={Math.PI / 1.65}
        target={[0, 0.72, 0]}
        autoRotate={autoRotate}
        autoRotateSpeed={0.55}
        enableDamping
        dampingFactor={0.08}
      />
      <EffectComposer enableNormalPass={false} multisampling={0}>
        <Bloom
          intensity={0.95}
          luminanceThreshold={0.18}
          luminanceSmoothing={0.28}
          mipmapBlur
        />
      </EffectComposer>
    </>
  );
}

/**
 * Interactive HD 4D Anima vessel — drag to turn, scroll/pinch to zoom.
 * Motion comes from @react-three/drei (`Float`, `Sparkles`, `OrbitControls`).
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
        camera={{ position: [0.55, 1.45, 2.55], fov: 34, near: 0.08, far: 40 }}
        gl={{ alpha: false, antialias: true, powerPreference: "high-performance" }}
        dpr={[1, dprMax]}
        style={style}
        onCreated={({ camera, gl }) => {
          camera.lookAt(0, 0.72, 0);
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.18;
        }}
      >
        <VesselStage model={model} autoRotate={autoRotate} />
      </Canvas>
    </div>
  );
}
