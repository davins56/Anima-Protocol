import { describe, expect, it } from "vitest";
import { sanitizeVesselConfig } from "../src/lib/vessel/vesselStore";

describe("sanitizeVesselConfig", () => {
  it("fills defaults and clamps", () => {
    const c = sanitizeVesselConfig({ height: 9, hair: { style: "bob", color: "#FF0000" }, effects: { particles: 5000 } }) as any;
    expect(c.schema).toBe(1);
    expect(c.height).toBe(1.15);
    expect(c.hair).toEqual({ style: "bob", color: "#ff0000" });
    expect(c.effects.particles).toBe(400);
  });
  it("drops unknown keys, bad colors and unsafe model urls", () => {
    const c = sanitizeVesselConfig({ evil: 1, skinTone: "red", model: { kind: "gltf", url: "javascript:alert(1)" } }) as any;
    expect(c.evil).toBeUndefined();
    expect(c.skinTone).toBe("#c99a7a");
    expect(c.model.url).toBeUndefined();
  });
});
