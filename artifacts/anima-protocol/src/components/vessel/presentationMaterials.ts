/**
 * Applies a PresentationTreatment (lib/vessel/presentation) to a vessel subtree.
 *
 * - Lit built-in materials (standard / physical / lambert / phong / toon) get a
 *   Fresnel rim on the emissive term and, for hologram, a tint, alpha and scan
 *   bands. Patched in place through onBeforeCompile + customProgramCacheKey so
 *   R3F prop updates (colour, emissive…) keep flowing to the same instance.
 *   Restored exactly (refcounted, shared glTF materials are safe) on change/unmount.
 * - MeshBasicMaterial (face planes, FX) only gets the hologram tint/alpha/scan.
 * - Custom shader materials (drei MeshTransmissionMaterial, ShaderMaterial…) are
 *   left alone; they still get the outline.
 * - Outline = one BackSide shell per eligible opaque mesh sharing the geometry
 *   (and skeleton / morph influences), pushed along the normal by a fraction of
 *   view depth. No render targets, no post-processing, no extra contexts.
 */
import * as THREE from "three";
import { treatmentKey, type PresentationTreatment } from "@/lib/vessel/presentation";

export type TreatmentUniforms = {
  rimColor: { value: THREE.Color };
  rimStrength: { value: number };
  rimPower: { value: number };
  holoTint: { value: THREE.Color };
  holoMix: { value: number };
  holoAlpha: { value: number };
  holoScan: { value: number };
  time: { value: number };
};

export type TreatmentState = {
  treatment: PresentationTreatment;
  uniforms: TreatmentUniforms;
  outlineMaterial: THREE.MeshBasicMaterial | null;
  materials: Set<THREE.Material>;
  outlines: Map<THREE.Mesh, THREE.Mesh>;
  frame: number;
};

type Saved = {
  onBeforeCompile: THREE.Material["onBeforeCompile"];
  customProgramCacheKey: THREE.Material["customProgramCacheKey"];
  hadOwnOBC: boolean;
  hadOwnKey: boolean;
  transparent: boolean;
  owners: Set<TreatmentState>;
};
const patched = new WeakMap<THREE.Material, Saved>();

/** Objects (or their ancestors) flagged with this userData key are skipped. */
export const NO_PRESENTATION = "animaNoPresentation";
const OUTLINE_FLAG = "animaPresentationOutline";

type Lit = THREE.MeshStandardMaterial | THREE.MeshLambertMaterial | THREE.MeshPhongMaterial | THREE.MeshToonMaterial;

export function materialKind(m: THREE.Material): "lit" | "basic" | null {
  // Materials that already customise compilation (drei transmission, shader materials) are skipped.
  if (Object.prototype.hasOwnProperty.call(m, "onBeforeCompile") && !patched.has(m)) return null;
  if ((m as THREE.ShaderMaterial).isShaderMaterial) return null;
  const x = m as Lit & { isMeshStandardMaterial?: boolean; isMeshLambertMaterial?: boolean; isMeshPhongMaterial?: boolean; isMeshToonMaterial?: boolean };
  if (x.isMeshStandardMaterial || x.isMeshLambertMaterial || x.isMeshPhongMaterial || x.isMeshToonMaterial) return "lit";
  if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial) return "basic";
  return null;
}

function makeUniforms(): TreatmentUniforms {
  return {
    rimColor: { value: new THREE.Color("#ffffff") },
    rimStrength: { value: 0 },
    rimPower: { value: 2 },
    holoTint: { value: new THREE.Color("#ffffff") },
    holoMix: { value: 0 },
    holoAlpha: { value: 1 },
    holoScan: { value: 0 },
    time: { value: 0 },
  };
}

/** Write a treatment's values into a uniform set. */
export function writeUniforms(u: TreatmentUniforms, t: PresentationTreatment) {
  u.rimColor.value.set(t.rim?.color ?? "#ffffff");
  u.rimStrength.value = t.rim?.strength ?? 0;
  u.rimPower.value = t.rim?.power ?? 2;
  u.holoTint.value.set(t.hologram?.tint ?? "#ffffff");
  u.holoMix.value = t.hologram?.mix ?? 0;
  u.holoAlpha.value = t.hologram?.alpha ?? 1;
  u.holoScan.value = t.hologram?.scan ?? 0;
}

/**
 * One uniform set per material, kept for the material's lifetime. three caches
 * compiled programs per material by cache key and binds uniforms only on the
 * first compile, so a re-applied treatment must reuse the same objects.
 */
const materialUniforms = new WeakMap<THREE.Material, TreatmentUniforms>();
export function uniformsFor(m: THREE.Material): TreatmentUniforms | undefined {
  return materialUniforms.get(m);
}

export function createTreatmentState(treatment: PresentationTreatment): TreatmentState {
  const uniforms = makeUniforms();
  writeUniforms(uniforms, treatment);
  return {
    treatment,
    uniforms,
    outlineMaterial: treatment.outline ? createOutlineMaterial(treatment.outline.color, treatment.outline.width) : null,
    materials: new Set(),
    outlines: new Map(),
    frame: 0,
  };
}

/** Per-frame: advance the hologram scan drift (0 when motion is reduced). */
export function tickTreatment(s: TreatmentState, seconds: number) {
  if (!s.treatment.hologram) return;
  const v = s.treatment.hologram.drift ? seconds : 0;
  for (const m of s.materials) {
    const u = materialUniforms.get(m);
    if (u && patched.get(m)?.owners.values().next().value === s) u.time.value = v;
  }
}

const HEADER = /* glsl */ `
uniform vec3 uAnimaRimColor;
uniform float uAnimaRimStrength;
uniform float uAnimaRimPower;
uniform vec3 uAnimaHoloTint;
uniform float uAnimaHoloMix;
uniform float uAnimaHoloAlpha;
uniform float uAnimaHoloScan;
uniform float uAnimaTime;
`;

const HOLO_DIFFUSE = /* glsl */ `
#include <color_fragment>
{
  float animaLum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
  diffuseColor.rgb = mix(diffuseColor.rgb, uAnimaHoloTint * (0.35 + animaLum * 1.3), uAnimaHoloMix);
  diffuseColor.a *= uAnimaHoloAlpha;
}
`;

const RIM = /* glsl */ `
#include <emissivemap_fragment>
{
  float animaFacing = abs(dot(normalize(normal), normalize(vViewPosition)));
  totalEmissiveRadiance += uAnimaRimColor * (pow(1.0 - animaFacing, uAnimaRimPower) * uAnimaRimStrength);
}
`;

const HOLO_EMISSIVE = /* glsl */ `
#include <emissivemap_fragment>
{
  float animaE = dot(totalEmissiveRadiance, vec3(0.299, 0.587, 0.114));
  totalEmissiveRadiance = mix(totalEmissiveRadiance, uAnimaHoloTint * animaE * 1.4, uAnimaHoloMix);
}
`;

const SCAN = /* glsl */ `
{
  float animaBand = step(0.5, fract((gl_FragCoord.y + uAnimaTime * 18.0) * 0.25));
  outgoingLight *= 1.0 - uAnimaHoloScan * animaBand;
}
#include <opaque_fragment>
`;

/** Pure GLSL rewrite (exported for tests). Returns the new fragment shader or null when the chunks are missing. */
export function injectFragment(fragment: string, kind: "lit" | "basic", t: PresentationTreatment): string | null {
  let out = fragment;
  const has = (chunk: string) => out.includes(`#include <${chunk}>`);
  if (t.hologram) {
    if (!has("color_fragment") || !has("opaque_fragment")) return null;
    out = out.replace("#include <color_fragment>", HOLO_DIFFUSE).replace("#include <opaque_fragment>", SCAN);
  }
  if (kind === "lit" && (t.rim || t.hologram)) {
    if (!has("emissivemap_fragment") || !has("normal_fragment_begin")) return null;
    if (out.indexOf("#include <normal_fragment_begin>") > out.indexOf("#include <emissivemap_fragment>")) return null;
    if (t.hologram) out = out.replace("#include <emissivemap_fragment>", HOLO_EMISSIVE);
    if (t.rim) out = out.replace("#include <emissivemap_fragment>", RIM);
  }
  if (out === fragment) return null;
  return out.replace("void main", HEADER + "void main");
}

function bindUniforms(shader: THREE.WebGLProgramParametersWithUniforms, u: TreatmentUniforms) {
  shader.uniforms.uAnimaRimColor = u.rimColor;
  shader.uniforms.uAnimaRimStrength = u.rimStrength;
  shader.uniforms.uAnimaRimPower = u.rimPower;
  shader.uniforms.uAnimaHoloTint = u.holoTint;
  shader.uniforms.uAnimaHoloMix = u.holoMix;
  shader.uniforms.uAnimaHoloAlpha = u.holoAlpha;
  shader.uniforms.uAnimaHoloScan = u.holoScan;
  shader.uniforms.uAnimaTime = u.time;
}

/** Patch one material for this state. Returns false when the material is not eligible. */
export function patchMaterial(m: THREE.Material, s: TreatmentState): boolean {
  const t = s.treatment;
  const existing = patched.get(m);
  if (existing) {
    existing.owners.add(s);
    return true;
  }
  const kind = materialKind(m);
  if (!kind) return false;
  if (kind === "basic" && !t.hologram) return false;
  if (kind === "lit" && !t.rim && !t.hologram) return false;
  const saved: Saved = {
    onBeforeCompile: m.onBeforeCompile,
    customProgramCacheKey: m.customProgramCacheKey,
    hadOwnOBC: Object.prototype.hasOwnProperty.call(m, "onBeforeCompile"),
    hadOwnKey: Object.prototype.hasOwnProperty.call(m, "customProgramCacheKey"),
    transparent: m.transparent,
    owners: new Set([s]),
  };
  const prevOBC = saved.onBeforeCompile;
  const prevKey = saved.customProgramCacheKey;
  const key = treatmentKey(t);
  let uniforms = materialUniforms.get(m);
  if (!uniforms) {
    uniforms = makeUniforms();
    materialUniforms.set(m, uniforms);
  }
  writeUniforms(uniforms, t);
  const bound = uniforms;
  m.onBeforeCompile = function (shader, renderer) {
    prevOBC.call(this, shader, renderer);
    const next = injectFragment(shader.fragmentShader, kind, t);
    if (next) {
      shader.fragmentShader = next;
      bindUniforms(shader, bound);
    }
  };
  m.customProgramCacheKey = function () {
    return `${prevKey.call(this)}|${key}`;
  };
  if (t.hologram) m.transparent = true;
  m.needsUpdate = true;
  patched.set(m, saved);
  return true;
}

export function unpatchMaterial(m: THREE.Material, s: TreatmentState) {
  const saved = patched.get(m);
  if (!saved) return;
  saved.owners.delete(s);
  if (saved.owners.size > 0) return;
  if (saved.hadOwnOBC) m.onBeforeCompile = saved.onBeforeCompile;
  else delete (m as Partial<THREE.Material>).onBeforeCompile;
  if (saved.hadOwnKey) m.customProgramCacheKey = saved.customProgramCacheKey;
  else delete (m as Partial<THREE.Material>).customProgramCacheKey;
  m.transparent = saved.transparent;
  m.needsUpdate = true;
  patched.delete(m);
}

export function isPatched(m: THREE.Material) {
  return patched.has(m);
}

export function createOutlineMaterial(color: string, width: number) {
  const mat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, toneMapped: false });
  const uWidth = { value: width };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uAnimaOutline = uWidth;
    shader.vertexShader = shader.vertexShader
      .replace("void main", "uniform float uAnimaOutline;\nvoid main")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
{
  float animaD = max(-(modelViewMatrix * vec4(position, 1.0)).z, 0.05);
  float animaS = max(length(modelMatrix[0].xyz), 1e-4);
  transformed += normalize(normal) * (uAnimaOutline * animaD / animaS);
}`,
      );
  };
  mat.customProgramCacheKey = () => "anima-pres-outline";
  mat.userData[OUTLINE_FLAG] = true;
  return mat;
}

// Created on first use: no three.js constructors at module top level (#729 chunk-order lesson).
let tmpScale: THREE.Vector3 | null = null;

/** Opaque, normal-carrying, not-tiny meshes get an outline shell. */
export function outlineEligible(mesh: THREE.Mesh): boolean {
  const any = mesh as THREE.Mesh & { isInstancedMesh?: boolean; isBatchedMesh?: boolean };
  if (!mesh.isMesh || any.isInstancedMesh || any.isBatchedMesh) return false;
  if (Array.isArray(mesh.material)) return false;
  const m = mesh.material as THREE.Material;
  if (!m || m.userData?.[OUTLINE_FLAG]) return false;
  if ((m as THREE.MeshBasicMaterial).isMeshBasicMaterial || (m as THREE.ShaderMaterial).isShaderMaterial) return false;
  if (m.blending === THREE.AdditiveBlending || m.depthWrite === false || m.opacity < 0.6 || m.visible === false) return false;
  const g = mesh.geometry;
  if (!g?.attributes?.normal || !g.attributes.position) return false;
  if (!g.boundingSphere) g.computeBoundingSphere();
  const r = g.boundingSphere?.radius ?? 0;
  const ws = mesh.getWorldScale((tmpScale ??= new THREE.Vector3()));
  return r * Math.max(ws.x, ws.y, ws.z) >= 0.03;
}

function makeOutline(mesh: THREE.Mesh, mat: THREE.Material): THREE.Mesh {
  let o: THREE.Mesh;
  const skinned = mesh as THREE.SkinnedMesh;
  if (skinned.isSkinnedMesh) {
    const so = new THREE.SkinnedMesh(mesh.geometry, mat);
    so.bind(skinned.skeleton, skinned.bindMatrix);
    so.bindMode = skinned.bindMode;
    o = so;
  } else {
    o = new THREE.Mesh(mesh.geometry, mat);
  }
  if (mesh.morphTargetInfluences) {
    o.morphTargetInfluences = mesh.morphTargetInfluences;
    o.morphTargetDictionary = mesh.morphTargetDictionary;
  }
  o.userData[OUTLINE_FLAG] = true;
  o.raycast = () => {};
  o.castShadow = false;
  o.receiveShadow = false;
  o.renderOrder = mesh.renderOrder;
  o.name = "anima-presentation-outline";
  return o;
}

function walk(obj: THREE.Object3D, visit: (o: THREE.Object3D) => void) {
  if (obj.userData?.[NO_PRESENTATION] || obj.userData?.[OUTLINE_FLAG]) return;
  visit(obj);
  for (const c of obj.children) walk(c, visit);
}

/** Bring the subtree in line with the state (idempotent; cheap to call every ~30 frames). */
export function syncTreatment(root: THREE.Object3D, s: TreatmentState) {
  const seen = new Set<THREE.Mesh>();
  walk(root, (obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    seen.add(mesh);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      if (m && !s.materials.has(m) && patchMaterial(m, s)) s.materials.add(m);
    }
    if (!s.outlineMaterial) return;
    const existing = s.outlines.get(mesh);
    if (outlineEligible(mesh)) {
      if (!existing) {
        const o = makeOutline(mesh, s.outlineMaterial);
        mesh.add(o);
        s.outlines.set(mesh, o);
      } else if (existing.geometry !== mesh.geometry) {
        existing.geometry = mesh.geometry;
      }
      const o = s.outlines.get(mesh)!;
      o.visible = mesh.visible;
    } else if (existing) {
      existing.removeFromParent();
      s.outlines.delete(mesh);
    }
  });
  for (const [mesh, o] of s.outlines) {
    if (!seen.has(mesh)) {
      o.removeFromParent();
      s.outlines.delete(mesh);
    }
  }
}

export function disposeTreatmentState(s: TreatmentState) {
  for (const m of s.materials) unpatchMaterial(m, s);
  s.materials.clear();
  for (const o of s.outlines.values()) o.removeFromParent();
  s.outlines.clear();
  s.outlineMaterial?.dispose();
}
