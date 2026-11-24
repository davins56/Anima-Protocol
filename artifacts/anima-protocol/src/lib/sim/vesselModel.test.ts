import { describe, expect, it } from "vitest";
import { vesselToBattleModel } from "./vesselModel";
import { parseVesselConfig } from "@/lib/vessel/vesselConfig";

describe("vesselToBattleModel", () => {
  it("forwards uploaded VRM models (previously dropped)", () => {
    const v = parseVesselConfig({
      model: { kind: "vrm", url: "/api/vessel/c1/model", path: "u/c1/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.vrm", format: "vrm", expressions: ["happy", "aa"], visemes: ["aa"], humanoid: true },
    });
    const m = vesselToBattleModel(v, "Serenity");
    expect(m.vrm_url).toBe("/api/vessel/c1/model");
    expect(m.gltf_url).toBeUndefined();
    expect(m.vessel_model).toMatchObject({ kind: "vrm", visemes: ["aa"], humanoid: true });
    expect(m.name).toBe("Serenity");
  });
  it("still forwards glTF via gltf_url, and nothing for procedural", () => {
    const g = vesselToBattleModel(parseVesselConfig({ model: { kind: "gltf", url: "/api/vessel/c1/model", format: "glb" } }));
    expect(g.gltf_url).toBe("/api/vessel/c1/model");
    expect(g.vrm_url).toBeUndefined();
    expect(g.vessel_model?.kind).toBe("gltf");
    const p = vesselToBattleModel(parseVesselConfig({}));
    expect(p.gltf_url).toBeUndefined();
    expect(p.vrm_url).toBeUndefined();
    expect(p.vessel_model).toBeUndefined();
    expect(vesselToBattleModel(null).color).toBe("#a78bfa");
  });
  it("carries the Essence net form only when the user set it (Cyberworld / net surfaces)", () => {
    expect(vesselToBattleModel(parseVesselConfig({ calibration: { netForm: "orb", source: { netForm: "photo" } } })).net_form).toBeUndefined();
    const m = vesselToBattleModel(
      parseVesselConfig({ eyes: { color: "#22d3ee" }, calibration: { netForm: "orb", silverWarmth: 100, resonance: { intensity: 40, glow: 70 }, source: { netForm: "user", silverWarmth: "user", "resonance.intensity": "user" } } }),
    );
    expect(m.net_form).toBe("orb");
    expect(m.net_look).toEqual({ core: "#22d3ee", silver: "#f1e4c8", glow: null, aura: 0.4 });
    const typed = vesselToBattleModel(parseVesselConfig({ calibration: { vesselType: "tree", source: { vesselType: "user" } } }));
    expect(typed.net_form).toBe("tree");
  });
});
