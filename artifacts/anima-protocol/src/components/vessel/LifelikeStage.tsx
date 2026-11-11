/**
 * Lighting / tone mapping for lifelike vessel bases (Vessel Studio, presence view).
 * Local CC0 HDRI (Poly Haven "Studio Small 09", public/vessels/env), AgX tone
 * mapping, a soft shadowed key light, rim + fill, contact shadow, and — on
 * medium/high tiers in HD — SMAA + a light bloom (lazy chunk). Chat never mounts this.
 */
import { Suspense, lazy, useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { ContactShadows, Environment } from "@react-three/drei";
import * as THREE from "three";

const LifelikePost = lazy(() => import("./LifelikePost"));

export const LIFELIKE_HDRI = "/vessels/env/studio_small_09_1k.hdr";

type Tier = { name: string; postprocessing: boolean };

export default function LifelikeStage({ tier, hd, rim, reducedMotion }: { tier: Tier; hd: boolean; rim: string; reducedMotion: boolean }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const prev = { tm: gl.toneMapping, exp: gl.toneMappingExposure, sh: gl.shadowMap.enabled, type: gl.shadowMap.type };
    gl.toneMapping = THREE.AgXToneMapping;
    gl.toneMappingExposure = 1.05;
    gl.shadowMap.enabled = tier.name !== "low";
    gl.shadowMap.type = THREE.PCFShadowMap;
    invalidate();
    return () => {
      gl.toneMapping = prev.tm;
      gl.toneMappingExposure = prev.exp;
      gl.shadowMap.enabled = prev.sh;
      gl.shadowMap.type = prev.type;
    };
  }, [gl, tier.name, invalidate]);
  const shadowSize = tier.name === "high" ? 2048 : 1024;
  const shadows = tier.name !== "low";
  return (
    <>
      <Suspense fallback={null}>
        <Environment files={LIFELIKE_HDRI} environmentIntensity={0.85} />
      </Suspense>
      <hemisphereLight args={["#f3efe9", "#2a2220", 0.25]} />
      <directionalLight
        position={[1.2, 2.6, 2.0]}
        intensity={2.2}
        color="#fff4ea"
        castShadow={shadows}
        shadow-mapSize-width={shadowSize}
        shadow-mapSize-height={shadowSize}
        shadow-bias={-0.0003}
        shadow-normalBias={0.02}
        shadow-radius={4}
        shadow-camera-left={-0.8}
        shadow-camera-right={0.8}
        shadow-camera-top={2.1}
        shadow-camera-bottom={-0.1}
        shadow-camera-near={0.5}
        shadow-camera-far={6}
      />
      <directionalLight position={[-1.6, 1.8, -1.4]} intensity={1.4} color={rim} />
      <directionalLight position={[-1.8, 1.2, 1.6]} intensity={0.45} color="#dfe8ff" />
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={2.4} blur={2.4} far={1.2} resolution={tier.name === "low" ? 256 : 512} frames={1} />
      {hd && tier.postprocessing && !reducedMotion && (
        <Suspense fallback={null}>
          <LifelikePost high={tier.name === "high"} />
        </Suspense>
      )}
    </>
  );
}
