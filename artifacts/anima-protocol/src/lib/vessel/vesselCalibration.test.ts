import { describe, expect, it } from "vitest";
import {
  CONTROLS_BY_FORM,
  DEFAULT_CALIBRATION,
  EYE_SHAPES,
  EYE_SHAPE_OPTIONS,
  HAIR_STYLES,
  HAIR_STYLE_OPTIONS,
  HAIR_STYLE_TO_MESH,
  SHAPE_OPTIONS,
  THEMES,
  THEME_OPTIONS,
  VESSEL_SHAPES,
  VESSEL_TYPES,
  VESSEL_TYPE_OPTIONS,
  hairMeshFor,
  normalizeVesselCalibration,
  resolveCalibratedLook,
  setCalibrationField,
  silverToneColor,
} from "./vesselCalibration";
import { HAIR_STYLES as MESH_HAIR_STYLES, VesselConfigSchema, defaultVesselFor, parseVesselConfig } from "./vesselConfig";

describe("normalizeVesselCalibration", () => {
  it("falls back to defaults for junk and never throws", () => {
    for (const raw of [null, undefined, 42, "x", [], { vesselType: "dragon", shape: 5, hair: "red" }]) {
      const c = normalizeVesselCalibration(raw);
      expect(c).toMatchObject({ version: 1, vesselType: "humanoid", shape: "slender", theme: "dark" });
      expect(c.hair).toEqual(DEFAULT_CALIBRATION.hair);
      expect(c.source).toEqual({});
    }
  });

  it("validates hex: lowercases #rrggbb, rejects #rgb, #rrggbbaa and names", () => {
    expect(normalizeVesselCalibration({ hair: { color: "#C8CCD4" } }).hair.color).toBe("#c8ccd4");
    expect(normalizeVesselCalibration({ eyes: { color: "#3B82F6" } }).eyes.color).toBe("#3b82f6");
    for (const bad of ["#fff", "#11223344", "red", 123]) {
      expect(normalizeVesselCalibration({ hair: { color: bad } }).hair.color).toBe(DEFAULT_CALIBRATION.hair.color);
    }
  });

  it("clamps and rounds 0-100 numbers", () => {
    const c = normalizeVesselCalibration({ resonance: { intensity: 140, glow: -3 }, silverWarmth: 49.6 });
    expect(c.resonance).toEqual({ intensity: 100, glow: 0 });
    expect(c.silverWarmth).toBe(50);
    expect(normalizeVesselCalibration({ silverWarmth: Number.NaN }).silverWarmth).toBe(DEFAULT_CALIBRATION.silverWarmth);
    expect(normalizeVesselCalibration({ silverWarmth: "12.4" }).silverWarmth).toBe(12);
  });

  it("case-folds enums, keeps netForm only for non-humanoid forms", () => {
    const c = normalizeVesselCalibration({ vesselType: "Crystal", netForm: "ORB", eyes: { shape: "closed" } });
    expect(c.vesselType).toBe("crystal");
    expect(c.netForm).toBe("orb");
    expect(c.eyes.shape).toBe("closed");
    expect(normalizeVesselCalibration({ netForm: "humanoid" }).netForm).toBeUndefined();
    expect(normalizeVesselCalibration({ netForm: null }).netForm).toBeUndefined();
  });

  it("keeps bounded unknown fields, drops name/tagline and prototype keys", () => {
    const c = normalizeVesselCalibration(JSON.parse('{"future":1,"name":"X","tagline":"y","__proto__":{"a":1},"hair":{"sheen":0.4},"bad-key":2}'));
    expect(c.future).toBe(1);
    expect((c.hair as Record<string, unknown>).sheen).toBe(0.4);
    expect(c).not.toHaveProperty("name");
    expect(c).not.toHaveProperty("tagline");
    expect(c).not.toHaveProperty("bad-key");
    const many = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`k${i}`, i]));
    expect(Object.keys(normalizeVesselCalibration(many)).filter((k) => /^k\d+$/.test(k))).toHaveLength(16);
  });

  it("keeps only valid source tags", () => {
    expect(normalizeVesselCalibration({ source: { "hair.color": "photo", shape: "user", theme: "admin" } }).source).toEqual({ "hair.color": "photo", shape: "user" });
  });

  it("setCalibrationField marks the path user and normalizes", () => {
    const c = setCalibrationField(normalizeVesselCalibration({}), "resonance.glow", 250);
    expect(c.resonance.glow).toBe(100);
    expect(c.source["resonance.glow"]).toBe("user");
  });
});

describe("option lists (one source of truth)", () => {
  it("covers every enum value with a label", () => {
    expect(VESSEL_TYPE_OPTIONS.map((o) => o.value)).toEqual([...VESSEL_TYPES]);
    expect(SHAPE_OPTIONS.map((o) => o.value)).toEqual([...VESSEL_SHAPES]);
    expect(HAIR_STYLE_OPTIONS.map((o) => o.value)).toEqual([...HAIR_STYLES]);
    expect(EYE_SHAPE_OPTIONS.map((o) => o.value)).toEqual([...EYE_SHAPES]);
    expect(THEME_OPTIONS.map((o) => o.value)).toEqual([...THEMES]);
  });
  it("lists which controls render per form", () => {
    expect(CONTROLS_BY_FORM.humanoid).toEqual(expect.arrayContaining(["shape", "hair.style", "hair.color", "eyes.shape", "eyes.color"]));
    for (const f of ["crystal", "orb", "chalice", "flame", "tree"] as const) {
      expect(CONTROLS_BY_FORM[f]).not.toContain("hair.style");
      expect(CONTROLS_BY_FORM[f]).not.toContain("shape");
      expect(CONTROLS_BY_FORM[f]).toContain("eyes.color");
      expect(CONTROLS_BY_FORM[f]).toContain("resonance.intensity");
    }
  });
});

describe("hair-style mapping onto existing meshes", () => {
  it("maps flowing→long(+sway), long→long, short→bob, braided→braid, none→hidden", () => {
    expect(hairMeshFor("flowing")).toEqual({ style: "long", sway: 1 });
    expect(hairMeshFor("long")).toEqual({ style: "long", sway: 0 });
    expect(hairMeshFor("short")).toEqual({ style: "bob", sway: 0 });
    expect(hairMeshFor("braided")).toEqual({ style: "braid", sway: 0 });
    expect(hairMeshFor("none")).toEqual({ style: null, sway: 0 });
  });
  it("only targets meshes that exist", () => {
    for (const m of Object.values(HAIR_STYLE_TO_MESH)) if (m) expect(MESH_HAIR_STYLES).toContain(m);
  });
});

describe("precedence: calibration drives a field only when its source is user", () => {
  // A photo-to-vessel / studio look: wild crimson hair, amber eyes.
  const photoVessel = parseVesselConfig({ bodyType: "athletic", hair: { style: "wild", color: "#b91c1c" }, eyes: { color: "#f59e0b", glow: 0.65 } });

  it("leaves the vessel untouched with no calibration or only default/photo sources", () => {
    expect(resolveCalibratedLook(photoVessel).config).toBe(photoVessel);
    const cal = { vesselType: "orb", shape: "compact", hair: { style: "short", color: "#ffffff" }, eyes: { color: "#000000", shape: "closed" }, resonance: { intensity: 90, glow: 90 }, silverWarmth: 100, theme: "light", source: { vesselType: "photo", "hair.color": "photo", "hair.style": "default" } };
    const look = resolveCalibratedLook(photoVessel, cal);
    expect(look.config).toBe(photoVessel);
    expect(look).toMatchObject({ form: "humanoid", netForm: null, hairHidden: false, eyeShape: null, aura: null, glow: null, silver: null, theme: null });
  });

  it("applies user-set fields at render time without rewriting config.hair/eyes", () => {
    const cal = setCalibrationField(setCalibrationField(setCalibrationField(normalizeVesselCalibration({}), "hair.style", "braided"), "eyes.color", "#3B82F6"), "shape", "tall");
    const look = resolveCalibratedLook(photoVessel, cal);
    expect(look.config.hair).toEqual({ style: "braid", color: "#b91c1c" }); // colour stays photo-derived
    expect(look.config.eyes).toEqual({ color: "#3b82f6", glow: 0.65 });
    expect(look.config.bodyType).toBe("tall");
    expect(photoVessel.hair.style).toBe("wild");
    expect(photoVessel.eyes.color).toBe("#f59e0b");
  });

  it("hides hair for none, closes eyes, maps resonance, silver and theme", () => {
    let cal = normalizeVesselCalibration({});
    for (const [p, v] of [["hair.style", "none"], ["eyes.shape", "closed"], ["resonance.intensity", 80], ["resonance.glow", 25], ["silverWarmth", 0], ["theme", "light"]] as const) cal = setCalibrationField(cal, p, v);
    const look = resolveCalibratedLook(photoVessel, cal);
    expect(look).toMatchObject({ hairHidden: true, eyeShape: "closed", aura: 0.8, glow: 0.25, silver: "#d9e2ec", theme: "light" });
    expect(look.config.eyes.glow).toBe(0.25);
  });

  it("uses the user's non-humanoid form, and netForm on net surfaces", () => {
    const cal = setCalibrationField(normalizeVesselCalibration({}), "vesselType", "flame");
    expect(resolveCalibratedLook(photoVessel, cal)).toMatchObject({ form: "flame", netForm: "flame" });
    const net = setCalibrationField(normalizeVesselCalibration({}), "netForm", "crystal");
    expect(resolveCalibratedLook(photoVessel, net)).toMatchObject({ form: "humanoid", netForm: "crystal" });
  });

  it("silver tone lerps cool platinum → warm moonlight", () => {
    expect(silverToneColor(0)).toBe("#d9e2ec");
    expect(silverToneColor(100)).toBe("#f1e4c8");
  });
});

describe("VesselConfigSchema keeps calibration", () => {
  it("round-trips config.calibration (normalized) instead of stripping it", () => {
    const parsed = VesselConfigSchema.parse({ ...defaultVesselFor({ name: "Serenity" }), calibration: { vesselType: "orb", resonance: { intensity: 300 }, source: { vesselType: "user" } } });
    expect(parsed.calibration?.vesselType).toBe("orb");
    expect(parsed.calibration?.resonance.intensity).toBe(100);
    expect(parsed.calibration?.source).toEqual({ vesselType: "user" });
  });
  it("is optional and a bad calibration never fails the vessel", () => {
    expect(parseVesselConfig({}).calibration).toBeUndefined();
    expect(VesselConfigSchema.safeParse({ calibration: "nonsense" }).success).toBe(true);
    expect(parseVesselConfig({ calibration: null }).calibration).toBeUndefined();
  });
});
