import { describe, expect, it } from "vitest";
import { sanitizeVesselConfig, VESSEL_SCHEMA_VERSION } from "../src/lib/vessel/vesselStore";

describe("sanitizeVesselConfig", () => {
  it("fills defaults and clamps", () => {
    const c = sanitizeVesselConfig({ height: 9, hair: { style: "bob", color: "#FF0000" }, effects: { particles: 5000 } }) as any;
    expect(c.schema).toBe(VESSEL_SCHEMA_VERSION);
    expect(c.schema).toBe(2);
    expect(c.height).toBe(1.15);
    expect(c.hair).toEqual({ style: "bob", color: "#ff0000" });
    expect(c.effects.particles).toBe(400);
  });

  it("drops unknown keys, bad colors and unsafe model urls", () => {
    const c = sanitizeVesselConfig({ evil: 1, skinTone: "red", model: { kind: "gltf", url: "javascript:alert(1)" } }) as any;
    expect(c.evil).toBeUndefined();
    expect(c.skinTone).toBe("#c99a7a");
    expect(c.model.url).toBeUndefined();
    expect(c.schema).toBe(2);
  });

  it("upgrades a schema 1 record and keeps safe same-origin model urls", () => {
    const c = sanitizeVesselConfig({
      schema: 1,
      model: { kind: "vrm", url: "/api/vessel/serenity/model", path: "user_1/serenity/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.vrm", extra: "nope" },
    }) as any;
    expect(c.schema).toBe(2);
    expect(c.model.kind).toBe("vrm");
    expect(c.model.url).toBe("/api/vessel/serenity/model");
    expect(c.model.path).toBe("user_1/serenity/aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee.vrm");
    expect(c.model.extra).toBeUndefined();
  });

  it("rejects http, traversal, .gltf, and https hosts that are not allow-listed", () => {
    const env = { VESSEL_MODEL_URL_HOSTS: "" } as NodeJS.ProcessEnv;
    const dropped = [
      "http://cdn.example.com/a.vrm",
      "https://cdn.example.com/a.vrm",
      "/api/vessel/../admin/model",
      "/api/vessel/%2e%2e/admin/model",
      "https://cdn.example.com/a.gltf",
      "/models/hero.vrm",
    ];
    for (const url of dropped) {
      const c = sanitizeVesselConfig({ model: { kind: "vrm", url } }, env) as any;
      expect(c.model.url).toBeUndefined();
    }
  });

  it("keeps an https .vrm/.glb URL only when the host is allow-listed", () => {
    const env = { VESSEL_MODEL_URL_HOSTS: "cdn.example.com, models.anima-protocol.com" } as NodeJS.ProcessEnv;
    const keep = sanitizeVesselConfig({ model: { kind: "vrm", url: "https://cdn.example.com/hero.vrm" } }, env) as any;
    expect(keep.model.url).toBe("https://cdn.example.com/hero.vrm");
    const glb = sanitizeVesselConfig({ model: { kind: "gltf", url: "https://models.anima-protocol.com/a.glb" } }, env) as any;
    expect(glb.model.url).toBe("https://models.anima-protocol.com/a.glb");
    const other = sanitizeVesselConfig({ model: { kind: "vrm", url: "https://evil.example/a.vrm" } }, env) as any;
    expect(other.model.url).toBeUndefined();
  });

  it("keeps expression and viseme metadata and drops unknown visemes", () => {
    const c = sanitizeVesselConfig({
      model: {
        kind: "vrm",
        format: "vrm",
        byteSize: 1234,
        humanoid: true,
        animationCount: 2,
        expressions: ["happy", "aa", "nope-name-is-fine", "", 7],
        visemes: ["aa", "AA", "foo", "oh"],
      },
    }) as any;
    expect(c.model.format).toBe("vrm");
    expect(c.model.byteSize).toBe(1234);
    expect(c.model.humanoid).toBe(true);
    expect(c.model.animationCount).toBe(2);
    expect(c.model.expressions).toEqual(["happy", "aa", "nope-name-is-fine"]);
    expect(c.model.visemes).toEqual(["aa", "oh"]);
  });
});
