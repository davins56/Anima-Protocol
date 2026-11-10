/**
 * Renders a steward-uploaded VRM / GLB vessel (config.model with a url).
 *
 * - Bytes come from the owner-only API route (lib/vessel/vesselModelAsset),
 *   suspending until downloaded; parse failures and download failures fall
 *   back to the caller's procedural vessel through the error boundary.
 * - VRM: real @pixiv/three-vrm runtime — mood expressions (eased), auto-blink,
 *   lip-sync visemes, look-at, relaxed arms, vrm.update(dt) every frame.
 * - Plain GLB: static scene (first animation clip plays if present), optionally
 *   tinted for the battle navi look.
 * Every parsed scene is owned by this instance and deep-disposed on unmount.
 */
import { Component, Suspense, use, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { Expression } from "@/lib/vessel/emotion";
import { loadVesselModelBytes, modelCacheKey, type VesselModelMeta } from "@/lib/vessel/vesselModelAsset";
import { disposeVesselAsset, parseVesselAsset, type ParsedVesselAsset } from "@/lib/vessel/vrmRuntime";
import {
  availableVrmPresets,
  createBlinker,
  easeWeights,
  expressionToVrmWeights,
  moodToVrmWeights,
  type VrmPreset,
  type VrmWeights,
} from "@/lib/vessel/vrmExpressions";
import { availableVisemes, speechOpenness, visemeWeights } from "@/lib/vessel/vrmVisemes";

export type UploadedVesselProps = {
  model: VesselModelMeta;
  /** Procedural face weights (used when no mood string is given). */
  expression?: Expression | null;
  mood?: string | null;
  intensity?: number;
  speaking?: boolean;
  /** Live voice level 0..1, read every frame; overrides the synthetic mouth pulse. */
  audioLevel?: (() => number | null | undefined) | null;
  /** Look at the camera (VRM look-at). */
  track?: boolean;
  /** Battle look for plain GLBs: recolour materials like AnimaVesselMesh's GltfBody. VRMs keep their own materials. */
  tint?: { color: string; hd?: boolean } | null;
  onFrame?: () => void;
  onLoaded?: (asset: ParsedVesselAsset) => void;
  /** Shown while loading and on any failure (usually the procedural vessel). */
  fallback: ReactNode;
};

class AssetBoundary extends Component<{ fallback: ReactNode; children: ReactNode; onError?: (e: unknown) => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(err: unknown) {
    this.props.onError?.(err);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Intersect declared metadata names with what the runtime model really has. */
function drivable(declared: Set<VrmPreset> | null, runtime: string[]): Set<VrmPreset> {
  const rt = new Set(runtime);
  const out = new Set<VrmPreset>();
  for (const n of rt) if (!declared || declared.has(n as VrmPreset)) out.add(n as VrmPreset);
  return out;
}

function tintScene(scene: THREE.Object3D, color: string, hd: boolean) {
  scene.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh || !mesh.material) return;
    const src = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = src.map((m0) => {
      const m = m0.clone() as THREE.MeshStandardMaterial & { transmission?: number; thickness?: number };
      if (m.color) m.color.set(color);
      if (m.emissive) m.emissive.set(color);
      if ("emissiveIntensity" in m) m.emissiveIntensity = 0.25;
      if ("roughness" in m) m.roughness = 0.25;
      if ("metalness" in m) m.metalness = 0.1;
      if (hd && "transmission" in m) {
        m.transmission = 0.25;
        m.thickness = 0.4;
      }
      m0.dispose();
      return m;
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0];
  });
}

function LoadedVessel({ model, expression, mood, intensity, speaking = false, audioLevel, track = true, tint, onFrame, onLoaded, fallback, cacheKey }: UploadedVesselProps & { cacheKey: string }) {
  const bytes = use(loadVesselModelBytes(model.url!, cacheKey));
  const [asset, setAsset] = useState<ParsedVesselAsset | null>(null);
  const [error, setError] = useState<unknown>(null);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    let live = true;
    let parsed: ParsedVesselAsset | null = null;
    parseVesselAsset(bytes)
      .then((a) => {
        if (!live) return disposeVesselAsset(a);
        parsed = a;
        setAsset(a);
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
      disposeVesselAsset(parsed);
      parsed = null;
    };
  }, [bytes]);

  useEffect(() => {
    if (!asset) return;
    if (!asset.vrm && tint) tintScene(asset.scene, tint.color, Boolean(tint.hd));
    onLoaded?.(asset);
    // tint applied once per parsed asset; colour changes on a plain GLB are rare
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset]);

  // VRM look-at follows the camera when tracking.
  useEffect(() => {
    const lookAt = asset?.vrm?.lookAt;
    if (!lookAt) return;
    lookAt.target = track ? camera : null;
    lookAt.autoUpdate = track;
  }, [asset, camera, track]);

  const mixer = useMemo(() => {
    if (!asset || !asset.animations.length) return null;
    const m = new THREE.AnimationMixer(asset.scene);
    m.clipAction(asset.animations[0]).play();
    return m;
  }, [asset]);
  useEffect(() => () => {
    mixer?.stopAllAction();
  }, [mixer]);

  const presets = useMemo(() => drivable(availableVrmPresets(model.expressions), asset?.expressionNames ?? []), [model.expressions, asset]);
  const visemes = useMemo(() => {
    const declared = availableVisemes(model.visemes);
    const rt = new Set(asset?.expressionNames ?? []);
    return (declared ?? (["aa", "ih", "ou", "ee", "oh"] as const).slice()).filter((v) => rt.has(v));
  }, [model.visemes, asset]);
  const moodWeights = useRef<VrmWeights>({});
  const mouthWeights = useRef<VrmWeights>({});
  const driven = useRef(new Set<string>());
  const blinker = useMemo(() => createBlinker(), []);

  useFrame(({ clock }, delta) => {
    if (!asset) return;
    const dt = Math.min(0.1, delta);
    const vrm = asset.vrm;
    if (vrm) {
      const em = vrm.expressionManager;
      if (em) {
        const target = mood != null ? moodToVrmWeights(mood, intensity, presets) : expression ? expressionToVrmWeights(expression, presets) : {};
        moodWeights.current = easeWeights(moodWeights.current, target, dt, 0.25);
        const tMs = clock.elapsedTime * 1000;
        const open = speechOpenness(tMs, speaking, audioLevel ? audioLevel() : null);
        mouthWeights.current = easeWeights(mouthWeights.current, visemeWeights(tMs, open, visemes), dt, 0.05);
        const frame: Record<string, number> = { ...moodWeights.current, ...mouthWeights.current };
        if (presets.has("blink")) frame.blink = blinker.update(dt, moodWeights.current.happy ?? 0);
        for (const name of driven.current) if (!(name in frame)) frame[name] = 0;
        for (const [name, w] of Object.entries(frame)) {
          em.setValue(name, w);
          driven.current.add(name);
        }
      }
      const h = vrm.humanoid;
      if (h && !mixer) {
        const t = clock.elapsedTime;
        const breathe = Math.sin(t * 1.4) * 0.02;
        const l = h.getNormalizedBoneNode("leftUpperArm");
        const r = h.getNormalizedBoneNode("rightUpperArm");
        if (l) l.rotation.z = -1.2 + breathe;
        if (r) r.rotation.z = 1.2 - breathe;
        const spine = h.getNormalizedBoneNode("spine");
        if (spine) spine.rotation.x = breathe * 0.5;
      }
    }
    mixer?.update(dt);
    vrm?.update(dt);
    onFrame?.();
  });

  if (error) throw error;
  if (!asset) return <>{fallback}</>;
  return <primitive object={asset.scene} />;
}

export default function UploadedVessel(props: UploadedVesselProps) {
  const key = modelCacheKey(props.model);
  if (!props.model?.url) return <>{props.fallback}</>;
  return (
    <AssetBoundary key={key} fallback={props.fallback} onError={(e) => console.warn("[vessel] uploaded model failed, using procedural vessel", e)}>
      <Suspense fallback={props.fallback}>
        <LoadedVessel {...props} cacheKey={key} />
      </Suspense>
    </AssetBoundary>
  );
}
