/**
 * three.js side of the photo head: PhotoHead data → Mesh (+ neck) → GLB bytes.
 * Texture projection happens here: the photo crop becomes the face baseColor.
 */
import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { ARKIT_HEAD_MORPHS, type PhotoHead } from "./headFit";

export type HeadColors = { hair: string; skin: string; mouth?: string };

/**
 * Vertex colours: white on the face/mouth (glTF multiplies COLOR_0 into every
 * primitive), and on the cranium a blend from the photo's edge colour at each
 * oval point to hair (crown) or skin (jaw / under-chin), hiding the mask seam.
 */
export function photoHeadVertexColors(head: PhotoHead, edgeColor: (landmark: number) => THREE.Color, colors: HeadColors): Float32Array {
  const n = head.positions.length / 3;
  const out = new Float32Array(n * 3).fill(1);
  const hair = new THREE.Color(colors.hair), skin = new THREE.Color(colors.skin);
  const cache = new Map<number, THREE.Color>();
  const c = new THREE.Color();
  for (const v of head.skull) {
    let e = cache.get(v.oval);
    if (!e) cache.set(v.oval, (e = edgeColor(v.oval)));
    const target = v.lower ? skin : hair;
    const t = v.lower ? Math.min(1, v.progress * 2.5) : Math.min(1, v.progress * 4);
    c.copy(e).lerp(target, t);
    out.set([c.r, c.g, c.b], v.index * 3);
  }
  return out;
}

export function photoHeadGeometry(head: PhotoHead, vertexColors?: Float32Array): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  if (vertexColors) g.setAttribute("color", new THREE.BufferAttribute(vertexColors, 3));
  g.setAttribute("position", new THREE.BufferAttribute(head.positions, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(head.uvs, 2));
  g.setIndex(new THREE.BufferAttribute(head.indices, 1));
  head.groups.forEach((gr, i) => g.addGroup(gr.start, gr.count, i));
  g.morphAttributes.position = ARKIT_HEAD_MORPHS.map((name) => {
    const a = new THREE.BufferAttribute(head.morphs[name], 3);
    a.name = name;
    return a;
  });
  g.morphTargetsRelative = true;
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/**
 * Build the head scene. `photo` is the full source image (canvas/img/bitmap);
 * only the landmark crop is copied into the texture (max `textureSize` px).
 */
export function buildPhotoHeadScene(
  head: PhotoHead,
  photo: CanvasImageSource & { width: number; height: number },
  colors: HeadColors,
  opts: { textureSize?: number; name?: string } = {},
): THREE.Group {
  const size = opts.textureSize ?? 1024;
  const { crop } = head;
  const k = Math.min(1, size / Math.max(crop.w, crop.h));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(crop.w * k));
  canvas.height = Math.max(1, Math.round(crop.h * k));
  canvas.getContext("2d")!.drawImage(photo, crop.x, crop.y, crop.w, crop.h, 0, 0, canvas.width, canvas.height);
  const map = new THREE.CanvasTexture(canvas);
  map.flipY = false; // UV v grows downward (glTF convention)
  map.colorSpace = THREE.SRGBColorSpace;
  map.name = "photoProjection";

  // The photo already carries its own lighting: a partial emissive copy keeps it
  // readable under the studio lights without going fully unlit.
  const face = new THREE.MeshStandardMaterial({ name: "face", map, emissiveMap: map, emissive: 0xffffff, emissiveIntensity: 0.4, roughness: 0.62, metalness: 0 });
  const hair = new THREE.MeshStandardMaterial({ name: "hair", color: 0xffffff, vertexColors: true, roughness: 0.85, metalness: 0 });
  const mouth = new THREE.MeshStandardMaterial({ name: "mouth", color: colors.mouth ?? "#3a1418", roughness: 0.9, side: THREE.DoubleSide });
  // Edge colour: the photo just inside each oval landmark (towards the face centre).
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const centerUv = [0.5, 0.5];
  const edgeColor = (lm: number) => {
    const u = head.uvs[lm * 2] * 0.9 + centerUv[0] * 0.1, v = head.uvs[lm * 2 + 1] * 0.9 + centerUv[1] * 0.1;
    const x = Math.max(0, Math.min(canvas.width - 3, Math.round(u * canvas.width) - 1));
    const y = Math.max(0, Math.min(canvas.height - 3, Math.round(v * canvas.height) - 1));
    const d = ctx.getImageData(x, y, 3, 3).data;
    let r = 0, gg = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; gg += d[i + 1]; b += d[i + 2]; }
    return new THREE.Color().setRGB(r / 9 / 255, gg / 9 / 255, b / 9 / 255, THREE.SRGBColorSpace);
  };
  const mesh = new THREE.Mesh(photoHeadGeometry(head, photoHeadVertexColors(head, edgeColor, colors)), [face, hair, mouth]);
  mesh.name = "PhotoHead";
  mesh.updateMorphTargets();

  const neckMat = new THREE.MeshStandardMaterial({ name: "neck", color: colors.skin, roughness: 0.7 });
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(head.neck.radius, head.neck.radius * 1.15, head.neck.height, 24, 1, true), neckMat);
  neck.position.set(...head.neck.center);
  neck.name = "Neck";

  const root = new THREE.Group();
  root.name = opts.name ?? "PhotoVesselHead";
  root.add(mesh, neck);
  return root;
}

export async function exportGlb(object: THREE.Object3D): Promise<ArrayBuffer> {
  const exporter = new GLTFExporter();
  const out = await exporter.parseAsync(object, { binary: true, onlyVisible: true, maxTextureSize: 2048 });
  if (!(out instanceof ArrayBuffer)) throw new Error("GLTFExporter did not return binary output");
  return out;
}

/**
 * Representative colour of a photo region (normalised rect), as #rrggbb: the
 * pixel at the given luminance percentile (0.5 = median; hair reads better a
 * little brighter than its shadowed median).
 */
export function sampleRegionColor(
  photo: CanvasImageSource & { width: number; height: number },
  rect: { x: number; y: number; w: number; h: number },
  percentile = 0.5,
): string {
  const W = photo.width, H = photo.height;
  const x = Math.max(0, Math.floor(rect.x * W)), y = Math.max(0, Math.floor(rect.y * H));
  const w = Math.max(1, Math.min(W - x, Math.floor(rect.w * W))), h = Math.max(1, Math.min(H - y, Math.floor(rect.h * H)));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(photo, x, y, w, h, 0, 0, w, h);
  return percentileColor(ctx.getImageData(0, 0, w, h).data, percentile);
}

/** RGBA bytes → #rrggbb of the pixel at a luminance percentile (transparent pixels skipped). */
export function percentileColor(d: Uint8ClampedArray | Uint8Array, percentile = 0.5): string {
  const px: [number, number, number, number][] = [];
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    px.push([0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2], d[i], d[i + 1], d[i + 2]]);
  }
  if (!px.length) return "#808080";
  px.sort((a, b) => a[0] - b[0]);
  const p = px[Math.min(px.length - 1, Math.max(0, Math.round((px.length - 1) * percentile)))];
  return `#${p.slice(1).map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
