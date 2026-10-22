import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { markResonanceNode, pickResonanceNode, toNdc } from "./resonancePicker";
import { createDissolveUniforms, injectDissolve, patchMaterial } from "./dissolve";

describe("resonance node raycast", () => {
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0, 10);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();

  it("hits a node behind a panel because the ray is layer-masked", () => {
    const scene = new THREE.Scene();
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4, 4, 0.1), new THREE.MeshBasicMaterial());
    panel.position.z = 2;
    const nodeGroup = new THREE.Group();
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.5), new THREE.MeshBasicMaterial());
    nodeGroup.add(node);
    markResonanceNode(nodeGroup, 3);
    scene.add(panel, nodeGroup);
    scene.updateMatrixWorld();
    const hit = pickResonanceNode(new THREE.Raycaster(), camera, { x: 0, y: 0 }, scene);
    expect(hit?.layer).toBe(3);
  });

  it("misses when the ray does not cross a node", () => {
    const scene = new THREE.Scene();
    const node = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshBasicMaterial());
    markResonanceNode(node, 1);
    node.position.x = 3;
    scene.add(node);
    scene.updateMatrixWorld();
    expect(pickResonanceNode(new THREE.Raycaster(), camera, { x: 0, y: 0 }, scene)).toBeNull();
  });

  it("converts client coords to NDC", () => {
    const c = toNdc(50, 50, { left: 0, top: 0, width: 100, height: 100 });
    expect(c.x).toBeCloseTo(0);
    expect(c.y).toBeCloseTo(0);
    expect(toNdc(0, 0, { left: 0, top: 0, width: 100, height: 100 })).toEqual({ x: -1, y: 1 });
  });
});

describe("dissolve shader patch", () => {
  it("injects into a built-in material shader and chains existing hooks", () => {
    const u = createDissolveUniforms();
    const shader = {
      vertexShader: "void main() {\n#include <begin_vertex>\n}",
      fragmentShader: "void main() {\n gl_FragColor = vec4(1.0);\n}",
      uniforms: {} as Record<string, unknown>,
    };
    expect(injectDissolve(shader, u)).toBe(true);
    expect(shader.uniforms.uDissolve).toBe(u.uDissolve);
    expect(shader.fragmentShader).toContain("discard");
    expect(shader.vertexShader).toContain("vDissolvePos =");

    const mat = new THREE.MeshStandardMaterial();
    let chained = false;
    mat.onBeforeCompile = () => {
      chained = true;
    };
    expect(patchMaterial(mat, u)).toBe(true);
    expect(patchMaterial(mat, u)).toBe(false);
    mat.onBeforeCompile({ ...shader, uniforms: {} } as never, null as never);
    expect(chained).toBe(true);
    expect(mat.customProgramCacheKey()).toContain("anima-dissolve");
  });

  it("leaves shaders without the expected hooks untouched", () => {
    const shader = { vertexShader: "void main(){}", fragmentShader: "void main(){}", uniforms: {} };
    expect(injectDissolve(shader, createDissolveUniforms())).toBe(false);
    expect(shader.fragmentShader).toBe("void main(){}");
  });
});
