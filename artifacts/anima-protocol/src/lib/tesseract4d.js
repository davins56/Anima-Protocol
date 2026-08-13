/**
 * 4D hypercube (tesseract) math — rotate in 4-space, then perspective-project
 * down to 3D so R3F can draw the lattice as line segments.
 *
 * A tesseract has 16 vertices (all ±½ combinations of x,y,z,w) and 32 edges
 * (pairs that differ in exactly one coordinate).
 */

export const TESSERACT_VERTEX_COUNT = 16;
export const TESSERACT_EDGE_COUNT = 32;

export const TESSERACT_VERTS = Object.freeze(
  Array.from({ length: TESSERACT_VERTEX_COUNT }, (_, i) =>
    Object.freeze([
      i & 1 ? 0.5 : -0.5,
      i & 2 ? 0.5 : -0.5,
      i & 4 ? 0.5 : -0.5,
      i & 8 ? 0.5 : -0.5,
    ]),
  ),
);

export const TESSERACT_EDGES = Object.freeze(
  (() => {
    const edges = [];
    for (let i = 0; i < TESSERACT_VERTEX_COUNT; i++) {
      for (let j = i + 1; j < TESSERACT_VERTEX_COUNT; j++) {
        let diffs = 0;
        for (let k = 0; k < 4; k++) {
          if (TESSERACT_VERTS[i][k] !== TESSERACT_VERTS[j][k]) diffs += 1;
        }
        if (diffs === 1) edges.push(Object.freeze([i, j]));
      }
    }
    return edges;
  })(),
);

function rot2(a, b, angle) {
  if (!angle) return [a, b];
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [a * c - b * s, a * s + b * c];
}

/**
 * Rotate a 4D point through any subset of the six planes.
 * @param {readonly number[]} point
 * @param {{ xy?: number, xz?: number, xw?: number, yz?: number, yw?: number, zw?: number }} angles
 */
export function rotate4d(point, angles = {}) {
  let x = point[0];
  let y = point[1];
  let z = point[2];
  let w = point[3];
  const { xy = 0, xz = 0, xw = 0, yz = 0, yw = 0, zw = 0 } = angles;
  [x, y] = rot2(x, y, xy);
  [x, z] = rot2(x, z, xz);
  [x, w] = rot2(x, w, xw);
  [y, z] = rot2(y, z, yz);
  [y, w] = rot2(y, w, yw);
  [z, w] = rot2(z, w, zw);
  return [x, y, z, w];
}

/**
 * Perspective project 4D → 3D from a camera sitting on the +W axis.
 * @param {readonly number[]} point
 * @param {number} [cameraW]
 */
export function project4to3(point, cameraW = 2.5) {
  const w = point[3];
  const denom = cameraW - w;
  const s = Math.abs(denom) < 1e-6 ? 1e6 : cameraW / denom;
  return [point[0] * s, point[1] * s, point[2] * s];
}

/** Scalar "size in 3-space" after a 4D rotation — used to pulse the vessel. */
export function wPhaseScale(angles, cameraW = 2.5) {
  const projected = TESSERACT_VERTS.map((v) => project4to3(rotate4d(v, angles), cameraW));
  let maxR = 0;
  for (const [x, y, z] of projected) {
    const r = Math.hypot(x, y, z);
    if (r > maxR) maxR = r;
  }
  return maxR;
}

export const TESSERACT_LINE_FLOATS = TESSERACT_EDGE_COUNT * 2 * 3;

/**
 * Fill a Float32Array of line-segment positions (32 edges × 2 verts × xyz).
 * @param {Float32Array} out
 * @param {{ xy?: number, xz?: number, xw?: number, yz?: number, yw?: number, zw?: number }} angles
 * @param {number} [cameraW]
 * @param {number} [scale]
 */
export function writeTesseractLinePositions(out, angles, cameraW = 2.5, scale = 1) {
  const verts = TESSERACT_VERTS.map((v) => {
    const p = project4to3(rotate4d(v, angles), cameraW);
    return [p[0] * scale, p[1] * scale, p[2] * scale];
  });
  let i = 0;
  for (const [a, b] of TESSERACT_EDGES) {
    out[i++] = verts[a][0];
    out[i++] = verts[a][1];
    out[i++] = verts[a][2];
    out[i++] = verts[b][0];
    out[i++] = verts[b][1];
    out[i++] = verts[b][2];
  }
  return out;
}

export function createTesseractLinePositions(angles = {}, cameraW = 2.5, scale = 1) {
  return writeTesseractLinePositions(
    new Float32Array(TESSERACT_LINE_FLOATS),
    angles,
    cameraW,
    scale,
  );
}
