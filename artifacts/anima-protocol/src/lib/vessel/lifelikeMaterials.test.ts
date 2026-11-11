import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { lifelikeRole, upgradeLifelikeMaterials } from "./lifelikeMaterials";

function meshWith(name: string) {
  return new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ name }));
}

describe("lifelikeMaterials", () => {
  it("maps exported material names to roles", () => {
    expect(lifelikeRole("VesselSkin")).toBe("skin");
    expect(lifelikeRole("VesselHairCurls")).toBe("hair");
    expect(lifelikeRole("VesselCloth_Sash")).toBe("cloth");
    expect(lifelikeRole("Other")).toBeNull();
  });

  it("upgrades skin/hair/cornea and keeps unknown materials", () => {
    const root = new THREE.Group();
    const skin = meshWith("VesselSkin");
    const hair = meshWith("VesselHair");
    const cornea = meshWith("VesselCornea");
    const other = meshWith("Other");
    const shared = meshWith("VesselSkin");
    shared.material = skin.material; // same source material → one upgrade
    root.add(skin, hair, cornea, other, shared);
    const made = upgradeLifelikeMaterials(root, { name: "low", transmission: 0 }, { shadows: true });
    expect(skin.material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(shared.material).toBe(skin.material);
    expect((skin.material as THREE.MeshPhysicalMaterial).sheen).toBeGreaterThan(0);
    expect((hair.material as THREE.MeshPhysicalMaterial).alphaTest).toBeGreaterThan(0.3);
    expect((hair.material as THREE.Material).side).toBe(THREE.DoubleSide);
    const c = cornea.material as THREE.MeshPhysicalMaterial;
    expect(c.transmission).toBe(0);
    expect(c.transparent).toBe(true);
    expect(other.material).toBeInstanceOf(THREE.MeshStandardMaterial);
    expect(skin.castShadow).toBe(true);
    expect(made.length).toBe(3);
    expect(made).not.toContain(other.material);
  });

  it("keeps the cornea a cheap alpha shell even on high tiers", () => {
    const root = new THREE.Group().add(meshWith("VesselCornea"));
    upgradeLifelikeMaterials(root, { name: "high", transmission: 0.35 }, { shadows: false });
    const c = (root.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial;
    expect(c.transmission).toBe(0);
    expect(c.depthWrite).toBe(false);
  });
});
