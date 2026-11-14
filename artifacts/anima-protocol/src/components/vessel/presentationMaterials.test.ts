import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { presentationTreatment } from "@/lib/vessel/presentation";
import {
  NO_PRESENTATION,
  createTreatmentState,
  disposeTreatmentState,
  injectFragment,
  isPatched,
  materialKind,
  outlineEligible,
  patchMaterial,
  syncTreatment,
  uniformsFor,
  unpatchMaterial,
} from "./presentationMaterials";

const fakeShader = (m: THREE.Material, lib: keyof typeof THREE.ShaderLib) => ({
  uniforms: {} as Record<string, { value: unknown }>,
  vertexShader: THREE.ShaderLib[lib].vertexShader,
  fragmentShader: THREE.ShaderLib[lib].fragmentShader,
  m,
});

function compile(m: THREE.Material, lib: keyof typeof THREE.ShaderLib) {
  const shader = fakeShader(m, lib);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  m.onBeforeCompile(shader as any, {} as THREE.WebGLRenderer);
  return shader;
}

describe("shader injection", () => {
  it("adds a Fresnel rim to every lit built-in material", () => {
    const t = presentationTreatment("netnavi");
    for (const lib of ["standard", "physical", "lambert", "phong", "toon"] as const) {
      const out = injectFragment(THREE.ShaderLib[lib].fragmentShader, "lit", t);
      expect(out, lib).toContain("uAnimaRimStrength");
      expect(out, lib).toContain("totalEmissiveRadiance += uAnimaRimColor");
      expect(out, lib).not.toContain("uAnimaHoloAlpha *"); // netnavi is opaque
    }
  });

  it("hologram tints, fades and scans lit and basic materials", () => {
    const t = presentationTreatment("hologram");
    const lit = injectFragment(THREE.ShaderLib.standard.fragmentShader, "lit", t)!;
    expect(lit).toContain("diffuseColor.a *= uAnimaHoloAlpha");
    expect(lit).toContain("uAnimaHoloScan");
    const basic = injectFragment(THREE.ShaderLib.basic.fragmentShader, "basic", t)!;
    expect(basic).toContain("diffuseColor.a *= uAnimaHoloAlpha");
    expect(basic).not.toContain("uAnimaRimColor *"); // basic has no normals/view vector
  });

  it("returns null when there is nothing to inject or chunks are missing", () => {
    expect(injectFragment(THREE.ShaderLib.basic.fragmentShader, "basic", presentationTreatment("netnavi"))).toBeNull();
    expect(injectFragment("void main(){}", "lit", presentationTreatment("netnavi"))).toBeNull();
  });
});

describe("material patching", () => {
  it("patches in place and restores the original material exactly", () => {
    const m = new THREE.MeshStandardMaterial({ color: "#123456" });
    const key0 = m.customProgramCacheKey();
    const s = createTreatmentState(presentationTreatment("hologram"));
    expect(patchMaterial(m, s)).toBe(true);
    expect(m.transparent).toBe(true);
    expect(m.customProgramCacheKey()).toContain("anima-pres:hologram");
    const shader = compile(m, "standard");
    expect(shader.fragmentShader).toContain("uAnimaHoloTint");
    expect(shader.uniforms.uAnimaHoloAlpha).toBe(uniformsFor(m)!.holoAlpha);
    unpatchMaterial(m, s);
    expect(isPatched(m)).toBe(false);
    expect(m.transparent).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(m, "onBeforeCompile")).toBe(false);
    expect(m.customProgramCacheKey()).toBe(key0);
  });

  it("reuses one uniform set per material across re-application (three binds uniforms once per program)", () => {
    const m = new THREE.MeshStandardMaterial();
    const a = createTreatmentState(presentationTreatment("netnavi"));
    patchMaterial(m, a);
    const first = uniformsFor(m);
    unpatchMaterial(m, a);
    const b = createTreatmentState(presentationTreatment("netnavi", { lite: true }));
    patchMaterial(m, b);
    expect(uniformsFor(m)).toBe(first);
    expect(first!.rimStrength.value).toBe(presentationTreatment("netnavi", { lite: true }).rim!.strength);
    unpatchMaterial(m, b);
  });

  it("is refcounted for materials shared between vessels (cloned glTF scenes)", () => {
    const m = new THREE.MeshStandardMaterial();
    const a = createTreatmentState(presentationTreatment("netnavi"));
    const b = createTreatmentState(presentationTreatment("netnavi"));
    patchMaterial(m, a);
    patchMaterial(m, b);
    unpatchMaterial(m, a);
    expect(isPatched(m)).toBe(true);
    unpatchMaterial(m, b);
    expect(isPatched(m)).toBe(false);
  });

  it("leaves custom shader materials alone", () => {
    const custom = new THREE.MeshPhysicalMaterial();
    custom.onBeforeCompile = () => {};
    expect(materialKind(custom)).toBeNull();
    expect(materialKind(new THREE.ShaderMaterial())).toBeNull();
    expect(materialKind(new THREE.MeshBasicMaterial())).toBe("basic");
    const s = createTreatmentState(presentationTreatment("netnavi"));
    expect(patchMaterial(new THREE.MeshBasicMaterial(), s)).toBe(false);
  });
});

describe("outline shells", () => {
  const body = () => new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 8), new THREE.MeshStandardMaterial());

  it("only outlines opaque, normal-carrying, visible-size meshes", () => {
    expect(outlineEligible(body())).toBe(true);
    expect(outlineEligible(new THREE.Mesh(new THREE.SphereGeometry(0.01), new THREE.MeshStandardMaterial()))).toBe(false);
    expect(outlineEligible(new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial()))).toBe(false);
    expect(outlineEligible(new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.3 })))).toBe(false);
    expect(outlineEligible(new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial({ blending: THREE.AdditiveBlending })))).toBe(false);
    expect(outlineEligible(new THREE.InstancedMesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial(), 4))).toBe(false);
  });

  it("sync adds one shell per eligible mesh, skips opted-out subtrees, and cleans up", () => {
    const root = new THREE.Group();
    const a = body();
    const b = body();
    const fx = new THREE.Group();
    fx.userData[NO_PRESENTATION] = true;
    const c = body();
    fx.add(c);
    root.add(a, b, fx);
    const s = createTreatmentState(presentationTreatment("netnavi"));
    syncTreatment(root, s);
    syncTreatment(root, s); // idempotent
    expect(a.children).toHaveLength(1);
    expect(b.children).toHaveLength(1);
    expect(c.children).toHaveLength(0);
    expect(isPatched(c.material as THREE.Material)).toBe(false);
    expect((a.children[0] as THREE.Mesh).geometry).toBe(a.geometry);
    root.remove(b);
    syncTreatment(root, s);
    expect(b.children).toHaveLength(0);
    disposeTreatmentState(s);
    expect(a.children).toHaveLength(0);
    expect(isPatched(a.material as THREE.Material)).toBe(false);
  });

  it("binds skinned shells to the same skeleton and morph influences", () => {
    const geo = new THREE.CylinderGeometry(0.1, 0.1, 1, 6, 2);
    const n = geo.attributes.position.count;
    geo.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0), 4));
    geo.setAttribute("skinWeight", new THREE.Float32BufferAttribute(new Array(n).fill([1, 0, 0, 0]).flat(), 4));
    const bone = new THREE.Bone();
    const mesh = new THREE.SkinnedMesh(geo, new THREE.MeshStandardMaterial());
    mesh.add(bone);
    mesh.bind(new THREE.Skeleton([bone]));
    mesh.morphTargetInfluences = [0.5];
    const root = new THREE.Group();
    root.add(mesh);
    const s = createTreatmentState(presentationTreatment("netnavi"));
    syncTreatment(root, s);
    const shell = mesh.children.find((c) => (c as THREE.SkinnedMesh).isSkinnedMesh) as THREE.SkinnedMesh;
    expect(shell.skeleton).toBe(mesh.skeleton);
    expect(shell.morphTargetInfluences).toBe(mesh.morphTargetInfluences);
    disposeTreatmentState(s);
  });

  it("does nothing at all for portrait", () => {
    const root = new THREE.Group();
    const a = body();
    root.add(a);
    const s = createTreatmentState(presentationTreatment("portrait"));
    syncTreatment(root, s);
    expect(a.children).toHaveLength(0);
    expect(isPatched(a.material as THREE.Material)).toBe(false);
  });
});
