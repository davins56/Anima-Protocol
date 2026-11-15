/**
 * Photo → head blockout (pure data, no three.js / DOM so it runs in unit tests).
 *
 * The face surface is the detected 468-point Face Landmarker mesh itself
 * (MediaPipe canonical topology, Apache 2.0). Head pose is removed by a
 * similarity alignment to the canonical face, so the fitted face keeps the
 * photo's proportions but faces +z upright. UVs are a frontal projection into
 * the photo crop. A procedural cranium is swept back from the face oval and a
 * mouth cavity is inset behind the inner lips. Morph targets use ARKit names.
 */
import { CANONICAL_VERTICES, FACE_TRIANGLES } from "./faceTopology.data";
import {
  CHEEKS,
  EYE_CORNERS,
  EYE_LID_PAIRS,
  EYE_UPPER_SECOND_RING,
  FACE_OVAL,
  INNER_LIP_LOOP,
  INNER_LIP_LOWER,
  INNER_LIP_UPPER,
  INNER_MOUTH_CORNERS,
  LANDMARK,
  MOUTH_CORNERS,
} from "./faceRegions";
import {
  add,
  centroid,
  clamp,
  cross,
  dist,
  dot,
  lerp,
  mulMat3,
  scale,
  similarityAlign,
  smoothstep,
  sub,
  transpose3,
  type Vec3,
} from "./math";

export const FACE_MESH_VERTICES = 468;
export const ARKIT_HEAD_MORPHS = ["eyeBlinkLeft", "eyeBlinkRight", "jawOpen", "mouthSmileLeft", "mouthSmileRight"] as const;
export type ArkitHeadMorph = (typeof ARKIT_HEAD_MORPHS)[number];

export type NormalizedLandmark = { x: number; y: number; z: number };

export type PhotoHeadOptions = {
  /** World position (m) of the cranium centre. Default sits on the procedural vessel's neck. */
  anchor?: Vec3;
  /** Rings swept from the face oval to the back of the head. */
  skullRings?: number;
  /** Extra margin around the landmark bbox for the texture crop (fraction of bbox). */
  cropMargin?: number;
  /** Cranium radial bulge (hair volume), fraction. */
  hairVolume?: number;
  /** Max jaw rotation for jawOpen = 1 (radians). */
  jawAngle?: number;
};

export type PhotoHeadGroup = { start: number; count: number; material: "face" | "hair" | "mouth" };

export type PhotoHead = {
  positions: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  groups: PhotoHeadGroup[];
  /** Relative (delta) morph targets, same length as positions. */
  morphs: Record<ArkitHeadMorph, Float32Array>;
  /** Photo pixel rect the UVs map into (v grows downward, i.e. glTF / flipY=false). */
  crop: { x: number; y: number; w: number; h: number };
  neck: { center: Vec3; radius: number; height: number };
  /** Cranium vertices: which oval landmark they sweep from and how far back (0..1); `lower` = jaw/under-chin path. */
  skull: { index: number; oval: number; progress: number; lower: boolean }[];
  metrics: {
    faceHeightCm: number;
    faceWidthCm: number;
    interocularCm: number;
    /** Head pose in the photo, degrees (yaw + = subject turned to their left). */
    yawDeg: number;
    pitchDeg: number;
    rollDeg: number;
    /** RMS distance (cm) between the aligned detection and the canonical face: identity + expression signal. */
    canonicalRmsCm: number;
    vertexCount: number;
    triangleCount: number;
  };
};

const CM = 0.01;

function canonical(i: number): Vec3 {
  return [CANONICAL_VERTICES[i * 3], CANONICAL_VERTICES[i * 3 + 1], CANONICAL_VERTICES[i * 3 + 2]];
}

/** Image-space landmarks (normalised) → pixel-scaled, y-up, z-toward-viewer. */
export function landmarksToPixelSpace(lm: NormalizedLandmark[], w: number, h: number): Vec3[] {
  return lm.map((p) => [p.x * w, -p.y * h, -p.z * w]);
}

/** Remove head pose: returns face points in canonical-aligned cm space. */
export function alignToCanonical(px: Vec3[]): { local: Vec3[]; R: number[]; s: number; rmsCm: number } {
  const n = FACE_MESH_VERTICES;
  const src: Vec3[] = [];
  const dst: Vec3[] = [];
  for (let i = 0; i < n; i++) {
    src.push(canonical(i));
    dst.push(px[i]);
  }
  const { s, R, t } = similarityAlign(src, dst);
  const Rt = transpose3(R);
  // Inverse similarity: local = Rᵀ (p − t) / s  (any point, incl. iris landmarks).
  const local = px.map((p) => scale(mulMat3(Rt, sub(p, t)), 1 / s));
  let se = 0;
  for (let i = 0; i < n; i++) se += dist(local[i], src[i]) ** 2;
  return { local, R: [...R], s, rmsCm: Math.sqrt(se / n) };
}

function rotX(v: Vec3, a: number): Vec3 {
  const c = Math.cos(a), s = Math.sin(a);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/** Piecewise-linear y(x) through a chain of points. */
function chainY(chain: Vec3[], x: number): number {
  const pts = [...chain].sort((a, b) => a[0] - b[0]);
  if (x <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / Math.max(1e-6, pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t;
    }
  }
  return pts[pts.length - 1][1];
}

export function fitPhotoHead(landmarks: NormalizedLandmark[], imageWidth: number, imageHeight: number, opts: PhotoHeadOptions = {}): PhotoHead {
  if (!Array.isArray(landmarks) || landmarks.length < FACE_MESH_VERTICES) {
    throw new Error(`Need at least ${FACE_MESH_VERTICES} face landmarks, got ${landmarks?.length ?? 0}.`);
  }
  const anchor = opts.anchor ?? [0, 1.6, 0.02];
  const K = Math.max(3, Math.round(opts.skullRings ?? 9));
  const margin = opts.cropMargin ?? 0.12;
  const bulge = opts.hairVolume ?? 0.1;
  const jawAngle = opts.jawAngle ?? 0.3;

  const px = landmarksToPixelSpace(landmarks, imageWidth, imageHeight);
  const { local: L, R, rmsCm } = alignToCanonical(px);
  const P = (i: number) => L[i];

  // ---- key measures (cm, canonical frame) ----
  const faceH = dist(P(LANDMARK.foreheadTop), P(LANDMARK.chin));
  const faceW = dist(P(LANDMARK.faceRight), P(LANDMARK.faceLeft));
  const interocular = dist(P(LANDMARK.eyeRightOuter), P(LANDMARK.eyeLeftOuter));
  const nose = P(LANDMARK.noseTip);
  const sideZ = (P(LANDMARK.faceRight)[2] + P(LANDMARK.faceLeft)[2]) / 2;
  const midY = (P(LANDMARK.foreheadTop)[1] + P(LANDMARK.chin)[1]) / 2;
  const center: Vec3 = [(P(LANDMARK.faceRight)[0] + P(LANDMARK.faceLeft)[0]) / 2, midY + faceH * 0.09, sideZ - faceH * 0.06];
  const headLength = faceH * 1.25; // nose tip→occiput ≈ 1.2–1.3 × (upper forehead→chin)
  const backDepth = Math.max(faceH * 0.62, headLength - (nose[2] - center[2]));

  // ---- vertices ----
  const verts: Vec3[] = [];
  const uvs: number[] = [];
  const cropX0 = Math.min(...landmarks.slice(0, FACE_MESH_VERTICES).map((p) => p.x)) * imageWidth;
  const cropX1 = Math.max(...landmarks.slice(0, FACE_MESH_VERTICES).map((p) => p.x)) * imageWidth;
  const cropY0 = Math.min(...landmarks.slice(0, FACE_MESH_VERTICES).map((p) => p.y)) * imageHeight;
  const cropY1 = Math.max(...landmarks.slice(0, FACE_MESH_VERTICES).map((p) => p.y)) * imageHeight;
  const mx = (cropX1 - cropX0) * margin;
  const my = (cropY1 - cropY0) * margin;
  const crop = {
    x: Math.max(0, Math.floor(cropX0 - mx)),
    y: Math.max(0, Math.floor(cropY0 - my)),
    w: 0,
    h: 0,
  };
  crop.w = Math.min(imageWidth, Math.ceil(cropX1 + mx)) - crop.x;
  crop.h = Math.min(imageHeight, Math.ceil(cropY1 + my)) - crop.y;
  const uvOf = (i: number): [number, number] => [
    clamp((landmarks[i].x * imageWidth - crop.x) / crop.w, 0, 1),
    clamp((landmarks[i].y * imageHeight - crop.y) / crop.h, 0, 1),
  ];

  for (let i = 0; i < FACE_MESH_VERTICES; i++) {
    verts.push(P(i));
    uvs.push(...uvOf(i));
  }

  // Mouth cavity: inset ring + deep centre behind the inner lips.
  const lipRing = INNER_LIP_LOOP.map((i) => P(i));
  const lipC = centroid(lipRing);
  const cavityStart = verts.length;
  for (let k = 0; k < INNER_LIP_LOOP.length; k++) {
    const p = lipRing[k];
    verts.push(add(lerp(lipC, p, 0.8), [0, 0, -faceH * 0.05]));
    uvs.push(...uvOf(INNER_LIP_LOOP[k]));
  }
  const cavityCenter = verts.length;
  verts.push(add(lipC, [0, -faceH * 0.01, -faceH * 0.13]));
  uvs.push(...uvOf(13));

  // Cranium: each face-oval point slerps back to the occiput pole (no ellipse
  // blow-ups when the oval sits far in front of the head centre).
  const skullStart = verts.length;
  const skull: PhotoHead["skull"] = [];
  const back: Vec3 = [0, 0, -1];
  // Ring 0 duplicates the oval so the cranium can carry its own vertex colours
  // (the face's shared vertices must stay white for the photo texture).
  for (let j = 0; j < FACE_OVAL.length; j++) {
    const rel = sub(P(FACE_OVAL[j]), center);
    skull.push({ index: verts.length, oval: FACE_OVAL[j], progress: 0, lower: rel[1] / Math.max(1e-6, Math.hypot(...rel)) < -0.2 });
    verts.push(P(FACE_OVAL[j]));
    uvs.push(...uvOf(FACE_OVAL[j]));
  }
  for (let k = 1; k < K; k++) {
    const p = k / K;
    for (let j = 0; j < FACE_OVAL.length; j++) {
      const rel = sub(P(FACE_OVAL[j]), center);
      const r0 = Math.max(1e-3, Math.hypot(rel[0], rel[1], rel[2]));
      const d0 = scale(rel, 1 / r0);
      const omega = Math.acos(clamp(dot(d0, back), -0.999, 0.999));
      const so = Math.sin(omega);
      const d = add(scale(d0, Math.sin((1 - p) * omega) / so), scale(back, Math.sin(p * omega) / so));
      const arc = Math.sin(Math.PI * p);
      // Hair volume on the crown/sides; tuck the under-jaw paths in toward the neck.
      const g = d0[1] > -0.35 ? 1 + bulge * arc : 1 - 0.22 * arc;
      const r = (r0 + (backDepth - r0) * p) * g;
      skull.push({ index: verts.length, oval: FACE_OVAL[j], progress: p, lower: d0[1] < -0.2 });
      verts.push(add(center, scale(d, r)));
      uvs.push(...uvOf(FACE_OVAL[j]));
    }
  }
  const pole = verts.length;
  skull.push({ index: pole, oval: FACE_OVAL[0], progress: 1, lower: false });
  verts.push([center[0], center[1], center[2] - backDepth * (1 + bulge * 0.2)]);
  uvs.push(0, 0);

  // ---- triangles ----
  const mouthFill = new Set(INNER_LIP_LOOP as readonly number[]);
  const faceIdx: number[] = [];
  for (let t = 0; t < FACE_TRIANGLES.length; t += 3) {
    const a = FACE_TRIANGLES[t], b = FACE_TRIANGLES[t + 1], c = FACE_TRIANGLES[t + 2];
    if (mouthFill.has(a) && mouthFill.has(b) && mouthFill.has(c)) continue; // open the mouth
    faceIdx.push(a, b, c);
  }
  const hairIdx: number[] = [];
  const orientOut = (a: number, b: number, c: number, out: number[], inward = false) => {
    const n = cross(sub(verts[b], verts[a]), sub(verts[c], verts[a]));
    const m = centroid([verts[a], verts[b], verts[c]]);
    const d = dot(n, sub(m, center));
    if ((d >= 0) !== inward) out.push(a, b, c);
    else out.push(a, c, b);
  };
  const N = FACE_OVAL.length;
  const ringIdx = (k: number, j: number) => skullStart + k * N + (j % N);
  for (let k = 0; k < K - 1; k++) {
    for (let j = 0; j < N; j++) {
      const a = ringIdx(k, j), b = ringIdx(k, j + 1), c = ringIdx(k + 1, j), d = ringIdx(k + 1, j + 1);
      orientOut(a, b, c, hairIdx);
      orientOut(b, d, c, hairIdx);
    }
  }
  for (let j = 0; j < N; j++) orientOut(ringIdx(K - 1, j), ringIdx(K - 1, j + 1), pole, hairIdx);

  const mouthIdx: number[] = [];
  const M = INNER_LIP_LOOP.length;
  for (let k = 0; k < M; k++) {
    const a = INNER_LIP_LOOP[k], b = INNER_LIP_LOOP[(k + 1) % M];
    const c = cavityStart + k, d = cavityStart + ((k + 1) % M);
    mouthIdx.push(a, b, c, b, d, c, c, d, cavityCenter);
  }

  const indices = new Uint32Array([...faceIdx, ...hairIdx, ...mouthIdx]);
  const groups: PhotoHeadGroup[] = [
    { start: 0, count: faceIdx.length, material: "face" },
    { start: faceIdx.length, count: hairIdx.length, material: "hair" },
    { start: faceIdx.length + hairIdx.length, count: mouthIdx.length, material: "mouth" },
  ];

  // ---- morph targets (cm deltas) ----
  const V = verts.length;
  const deltas: Record<ArkitHeadMorph, Vec3[]> = {
    eyeBlinkLeft: [], eyeBlinkRight: [], jawOpen: [], mouthSmileLeft: [], mouthSmileRight: [],
  };
  for (const k of ARKIT_HEAD_MORPHS) deltas[k] = Array.from({ length: V }, () => [0, 0, 0] as Vec3);

  // Blink: upper lid drops onto a line just above the lower lid; lower lid rises a little.
  for (const side of ["left", "right"] as const) {
    const key: ArkitHeadMorph = side === "left" ? "eyeBlinkLeft" : "eyeBlinkRight";
    const lidDelta = new Map<number, Vec3>();
    for (const [u, l] of EYE_LID_PAIRS[side]) {
      const pu = P(u), pl = P(l);
      const closed: Vec3 = lerp(pl, pu, 0.22);
      closed[2] = Math.max(pu[2], pl[2]) + faceH * 0.004;
      const du = sub(closed, pu);
      deltas[key][u] = du;
      deltas[key][l] = sub(closed, pl);
      lidDelta.set(u, du);
    }
    for (const [ring, lid] of EYE_UPPER_SECOND_RING[side]) {
      const d = lidDelta.get(lid);
      if (d) deltas[key][ring] = scale(d, 0.4);
    }
    // Corners stay put (explicit for clarity).
    for (const c of EYE_CORNERS[side]) deltas[key][c] = [0, 0, 0];
  }

  // Jaw: lower face rotates about a hinge near the ears.
  const pivot: Vec3 = [center[0], nose[1] - faceH * 0.04, sideZ - faceH * 0.04];
  const upperChain = [INNER_MOUTH_CORNERS.right, ...INNER_LIP_UPPER, INNER_MOUTH_CORNERS.left].map((i) => P(i));
  const lowerChain = [INNER_MOUTH_CORNERS.right, ...INNER_LIP_LOWER, INNER_MOUTH_CORNERS.left].map((i) => P(i));
  const cR = P(MOUTH_CORNERS.right), cL = P(MOUTH_CORNERS.left);
  const mouthW = dist(cR, cL);
  const mouthCx = (cR[0] + cL[0]) / 2;
  const mouthY = (cR[1] + cL[1]) / 2;
  const halfW = mouthW / 2;
  const upperInner = new Set<number>(INNER_LIP_UPPER);
  const lowerInner = new Set<number>(INNER_LIP_LOWER);
  const jawW = new Float32Array(V);
  const faceJawWeight = (i: number): number => {
    if (upperInner.has(i)) return 0;
    if (lowerInner.has(i)) return 1;
    const p = P(i);
    if (p[1] > mouthY + faceH * 0.12) return 0;
    const dx = Math.abs(p[0] - mouthCx);
    const cx = clamp(p[0], mouthCx - halfW, mouthCx + halfW);
    const mid = (chainY(upperChain, cx) + chainY(lowerChain, cx)) / 2;
    const band = faceH * 0.012;
    const wMouth = smoothstep(mid + band, mid - band, p[1]);
    const wY = smoothstep(mouthY - faceH * 0.02, mouthY - faceH * 0.14, p[1]);
    const a = smoothstep(halfW * 0.85, halfW * 1.5, dx);
    return wMouth * (1 - a) + wY * a;
  };
  for (let i = 0; i < FACE_MESH_VERTICES; i++) jawW[i] = faceJawWeight(i);
  for (const c of [MOUTH_CORNERS.right, MOUTH_CORNERS.left, INNER_MOUTH_CORNERS.right, INNER_MOUTH_CORNERS.left]) jawW[c] = 0.4;
  for (let k = 0; k < M; k++) jawW[cavityStart + k] = jawW[INNER_LIP_LOOP[k]];
  jawW[cavityCenter] = 0.5;
  for (let k = 0; k < K; k++) {
    const fall = (1 - k / K) ** 1.5;
    for (let j = 0; j < N; j++) jawW[skullStart + k * N + j] = jawW[FACE_OVAL[j]] * fall;
  }
  for (let i = 0; i < V; i++) {
    if (!jawW[i]) continue;
    const rel = sub(verts[i], pivot);
    deltas.jawOpen[i] = scale(sub(rotX(rel, jawAngle), rel), jawW[i]);
  }

  // Smile: corners pull up/out/back, cheeks lift.
  for (const side of ["left", "right"] as const) {
    const key: ArkitHeadMorph = side === "left" ? "mouthSmileLeft" : "mouthSmileRight";
    const corner = P(MOUTH_CORNERS[side]);
    const cheek = P(CHEEKS[side]);
    const sx = Math.sign(corner[0] - mouthCx) || (side === "left" ? 1 : -1);
    const r1 = mouthW * 0.42, r2 = mouthW * 0.55;
    for (let i = 0; i < FACE_MESH_VERTICES; i++) {
      const p = P(i);
      const w1 = Math.exp(-((dist(p, corner) / r1) ** 2));
      const w2 = Math.exp(-((dist(p, cheek) / r2) ** 2));
      const d: Vec3 = [
        w1 * sx * 0.12 * mouthW,
        w1 * 0.16 * mouthW + w2 * 0.06 * mouthW,
        -w1 * 0.05 * mouthW + w2 * 0.04 * mouthW,
      ];
      deltas[key][i] = d;
    }
  }

  // Oval duplicates follow their face vertex exactly (no cracks under any morph).
  for (const k of ARKIT_HEAD_MORPHS) for (let j = 0; j < N; j++) deltas[k][skullStart + j] = [...deltas[k][FACE_OVAL[j]]] as Vec3;

  // ---- to world metres ----
  const positions = new Float32Array(V * 3);
  for (let i = 0; i < V; i++) {
    const w = add(anchor, scale(sub(verts[i], center), CM));
    positions.set(w, i * 3);
  }
  const morphs = {} as Record<ArkitHeadMorph, Float32Array>;
  for (const k of ARKIT_HEAD_MORPHS) {
    const arr = new Float32Array(V * 3);
    deltas[k].forEach((d, i) => arr.set(scale(d, CM), i * 3));
    morphs[k] = arr;
  }

  // Pose from R (maps canonical → photo, y-up). Euler XYZ-ish approximation.
  const yawDeg = (Math.asin(clamp(R[2], -1, 1)) * 180) / Math.PI;
  const pitchDeg = (Math.atan2(-R[5], R[8]) * 180) / Math.PI;
  const rollDeg = (Math.atan2(-R[1], R[0]) * 180) / Math.PI;

  const chin = P(LANDMARK.chin);
  const neckTop = add(anchor, scale(sub([center[0], chin[1] + faceH * 0.18, center[2] - faceH * 0.08], center), CM));
  const neckHeight = faceH * 0.75 * CM;

  return {
    positions,
    uvs: new Float32Array(uvs),
    indices,
    groups,
    morphs,
    crop,
    neck: { center: [neckTop[0], neckTop[1] - neckHeight / 2, neckTop[2]], radius: faceW * 0.3 * CM, height: neckHeight },
    skull,
    metrics: {
      faceHeightCm: faceH,
      faceWidthCm: faceW,
      interocularCm: interocular,
      yawDeg,
      pitchDeg,
      rollDeg,
      canonicalRmsCm: rmsCm,
      vertexCount: V,
      triangleCount: indices.length / 3,
    },
  };
}
