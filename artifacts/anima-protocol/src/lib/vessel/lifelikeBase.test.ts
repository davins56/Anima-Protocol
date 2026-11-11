import { describe, expect, it } from "vitest";
import { isLifelikeModel, lifelikeAssetPath, lifelikeModelFor, withLifelikeBase } from "./lifelikeBase";
import { VesselConfigSchema, defaultVesselFor, parseVesselConfig } from "./vesselConfig";

describe("lifelikeBase", () => {
  it("stores a canonical https URL that the config schema accepts", () => {
    const model = lifelikeModelFor("scarlet");
    expect(model.url).toBe("https://anima-protocol.com/vessels/scarlet-lifelike.glb");
    const cfg = withLifelikeBase(defaultVesselFor({ name: "Scarlet" }), "scarlet");
    expect(VesselConfigSchema.safeParse(cfg).success).toBe(true);
    expect(parseVesselConfig(cfg).model.url).toBe(model.url);
    expect(isLifelikeModel(cfg.model)).toBe(true);
  });

  it("applies Serenity's approved angelic look", () => {
    const cfg = withLifelikeBase(defaultVesselFor({ name: "Serenity" }), "serenity");
    expect(cfg.base).toBe("serenity");
    expect(cfg.effects.aura).toBe("wings");
    expect(cfg.hair.color).toBe("#f5f6fa");
  });

  it("maps only trusted / same-origin URLs back to the bundled path", () => {
    expect(lifelikeAssetPath("https://anima-protocol.com/vessels/serenity-lifelike.glb")).toBe("/vessels/serenity-lifelike.glb");
    expect(lifelikeAssetPath("/vessels/scarlet-lifelike.glb")).toBe("/vessels/scarlet-lifelike.glb");
    expect(lifelikeAssetPath("http://127.0.0.1:5173/vessels/scarlet-lifelike.glb", "http://127.0.0.1:5173")).toBe("/vessels/scarlet-lifelike.glb");
    expect(lifelikeAssetPath("https://evil.example/vessels/scarlet-lifelike.glb", "https://anima-protocol.com")).toBeNull();
    expect(lifelikeAssetPath("http://anima-protocol.com/vessels/scarlet-lifelike.glb", "https://x.dev")).toBeNull();
    expect(lifelikeAssetPath("https://anima-protocol.com/vessels/../x-lifelike.glb")).toBeNull();
    expect(lifelikeAssetPath("https://anima-protocol.com/other.glb")).toBeNull();
    expect(lifelikeAssetPath("/api/vessel/abc/model")).toBeNull();
    expect(isLifelikeModel({ kind: "vrm", url: "https://anima-protocol.com/vessels/scarlet-lifelike.glb" })).toBe(false);
  });
});
