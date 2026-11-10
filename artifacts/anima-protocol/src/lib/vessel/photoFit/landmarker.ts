/**
 * On-device MediaPipe Face + Pose Landmarker (Apache 2.0). Every asset is served
 * from this origin (`/mediapipe/...`, populated by scripts/fetch-mediapipe-assets.mjs):
 * no third-party runtime calls and the photo never leaves the browser.
 */
import type { FaceLandmarker, FaceLandmarkerResult, PoseLandmarker, PoseLandmarkerResult } from "@mediapipe/tasks-vision";

export const MEDIAPIPE_BASE = "/mediapipe";
export const MEDIAPIPE_ASSETS = {
  wasm: `${MEDIAPIPE_BASE}/wasm`,
  face: `${MEDIAPIPE_BASE}/models/face_landmarker.task`,
  pose: `${MEDIAPIPE_BASE}/models/pose_landmarker_lite.task`,
} as const;

type Landmarkers = { face: FaceLandmarker; pose: PoseLandmarker; delegate: "GPU" | "CPU" };
let loading: Promise<Landmarkers> | null = null;

async function create(delegate: "GPU" | "CPU"): Promise<Landmarkers> {
  // Lazy import keeps the ~150 KB JS + 14 MB WASM out of every other route.
  const { FilesetResolver, FaceLandmarker, PoseLandmarker } = await import("@mediapipe/tasks-vision");
  const fileset = await FilesetResolver.forVisionTasks(MEDIAPIPE_ASSETS.wasm);
  const face = await FaceLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MEDIAPIPE_ASSETS.face, delegate },
    runningMode: "IMAGE",
    numFaces: 1,
    outputFaceBlendshapes: true,
    outputFacialTransformationMatrixes: true,
  });
  const pose = await PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MEDIAPIPE_ASSETS.pose, delegate },
    runningMode: "IMAGE",
    numPoses: 1,
  });
  return { face, pose, delegate };
}

export function loadLandmarkers(prefer: "GPU" | "CPU" = "CPU"): Promise<Landmarkers> {
  if (!loading) {
    loading = create(prefer).catch((e) => {
      if (prefer === "GPU") return create("CPU");
      throw e;
    });
    loading.catch(() => (loading = null));
  }
  return loading;
}

export type PhotoLandmarks = {
  face: FaceLandmarkerResult;
  pose: PoseLandmarkerResult;
  ms: { face: number; pose: number };
  delegate: "GPU" | "CPU";
};

export async function detectPhotoLandmarks(image: HTMLImageElement | HTMLCanvasElement | ImageBitmap): Promise<PhotoLandmarks> {
  const lm = await loadLandmarkers();
  const t0 = performance.now();
  const face = lm.face.detect(image);
  const t1 = performance.now();
  const pose = lm.pose.detect(image);
  const t2 = performance.now();
  return { face, pose, ms: { face: t1 - t0, pose: t2 - t1 }, delegate: lm.delegate };
}

/** Top-N blendshape scores (ARKit names) of the first face. */
export function topBlendshapes(face: FaceLandmarkerResult, n = 8): { name: string; score: number }[] {
  const cats = face.faceBlendshapes?.[0]?.categories ?? [];
  return [...cats]
    .filter((c) => c.categoryName !== "_neutral")
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((c) => ({ name: c.categoryName, score: c.score }));
}
