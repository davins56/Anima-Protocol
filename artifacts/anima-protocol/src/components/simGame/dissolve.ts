/**
 * Phase-shift dissolve, injected into *existing* materials via onBeforeCompile
 * so AnimaVesselMesh / SerenityFigure / VirusFigure keep their own look
 * (physical crystal, drei transmission, emissive) and just gain a noise
 * dissolve with a band-coloured burning edge. All patched materials under a
 * DissolveGroup share one uniform set, so one number drives the whole vessel.
 */
import * as THREE from "three";

export type DissolveUniforms = {
  uDissolve: { value: number };
  uDissolveEdge: { value: THREE.Color };
  uDissolveScale: { value: number };
  uDissolveOrigin: { value: THREE.Vector3 };
};

export function createDissolveUniforms(color = "#8B5CF6"): DissolveUniforms {
  return {
    uDissolve: { value: 0 },
    uDissolveEdge: { value: new THREE.Color(color) },
    uDissolveScale: { value: 5.5 },
    uDissolveOrigin: { value: new THREE.Vector3() },
  };
}

const NOISE_GLSL = /* glsl */ `
uniform float uDissolve;
uniform vec3 uDissolveEdge;
uniform float uDissolveScale;
uniform vec3 uDissolveOrigin;
varying vec3 vDissolvePos;
float dHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dNoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(dHash(i), dHash(i + vec3(1,0,0)), f.x), mix(dHash(i + vec3(0,1,0)), dHash(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(dHash(i + vec3(0,0,1)), dHash(i + vec3(1,0,1)), f.x), mix(dHash(i + vec3(0,1,1)), dHash(i + vec3(1,1,1)), f.x), f.y),
    f.z);
}
`;

const MAIN_RE = /void\s+main\s*\(\s*\)\s*\{/;
const PATCHED = new WeakSet<THREE.Material>();

/** Rewrite compiled shader sources. Returns false (and leaves them untouched) if the hooks aren't there. */
export function injectDissolve(shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, unknown> }, u: DissolveUniforms): boolean {
  if (!shader.vertexShader.includes("#include <begin_vertex>") || !MAIN_RE.test(shader.fragmentShader)) return false;
  const end = shader.fragmentShader.lastIndexOf("}");
  if (end < 0) return false;
  Object.assign(shader.uniforms, u);
  shader.vertexShader =
    "varying vec3 vDissolvePos;\n" +
    shader.vertexShader.replace(
      "#include <begin_vertex>",
      "#include <begin_vertex>\n  vDissolvePos = (modelMatrix * vec4(transformed, 1.0)).xyz;",
    );
  let frag = shader.fragmentShader;
  frag = frag.slice(0, end) + "  gl_FragColor.rgb += uDissolveEdge * dEdge * 2.5;\n" + frag.slice(end);
  frag = frag.replace(
    MAIN_RE,
    (m) => `${m}
  vec3 dp = (vDissolvePos - uDissolveOrigin) * uDissolveScale;
  float dN = dNoise(dp) * 0.7 + dNoise(dp * 2.7) * 0.3;
  if (uDissolve > 0.001 && dN < uDissolve * 1.05) discard;
  float dEdge = uDissolve > 0.001 ? 1.0 - smoothstep(0.0, 0.09, dN - uDissolve * 1.05) : 0.0;`,
  );
  shader.fragmentShader = NOISE_GLSL + frag;
  return true;
}

/** Patch one material in place (idempotent; chains any existing onBeforeCompile). */
export function patchMaterial(mat: THREE.Material, u: DissolveUniforms): boolean {
  if (!mat || PATCHED.has(mat)) return false;
  PATCHED.add(mat);
  const prev = mat.onBeforeCompile;
  const prevKey = mat.customProgramCacheKey;
  mat.onBeforeCompile = function (shader, renderer) {
    prev?.call(this, shader, renderer);
    injectDissolve(shader, u);
  };
  mat.customProgramCacheKey = function () {
    return `${prevKey ? prevKey.call(this) : ""}|anima-dissolve-v1`;
  };
  mat.needsUpdate = true;
  return true;
}

/** Patch every material below `root`. Returns how many were newly patched. */
export function patchTree(root: THREE.Object3D, u: DissolveUniforms): number {
  let n = 0;
  root.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) if (patchMaterial(mat, u)) n++;
  });
  return n;
}
