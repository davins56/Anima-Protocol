import { describe, expect, it } from "vitest";
import {
  CALIBRATION_UNKNOWN_BYTES,
  DEFAULT_CALIBRATION,
  RENDERED_TYPES,
  VESSEL_TYPES,
  addReflectionDraft,
  loadEssenceProfile,
  loadReflectionDrafts,
  normalizeVesselCalibration,
  removeReflectionDraft,
  saveEssenceProfile,
  setCalibrationField,
  silverToneColor,
  unknownFieldBytes,
  validateEssenceIdentity,
} from "./calibration";
import { dreamMoods, dreamThemes, dreamsPerWeek } from "./patterns";
import { essencePath, essenceScreenOf, ESSENCE_SCREENS } from "./flag";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe("normalizeVesselCalibration (v1)", () => {
  it("defaults garbage to the v1 defaults", () => {
    expect(normalizeVesselCalibration(null)).toEqual(DEFAULT_CALIBRATION);
    expect(normalizeVesselCalibration("x")).toEqual(DEFAULT_CALIBRATION);
  });

  it("clamps 0-100, validates hex and enums, keeps unknown fields", () => {
    const out = normalizeVesselCalibration({
      version: 7,
      vesselType: "ORB",
      netForm: "flame",
      shape: "blob",
      hair: { style: "braided", color: "#ABCDEF" },
      eyes: { shape: "closed", color: "blue" },
      resonance: { intensity: 140, glow: -5 },
      silverWarmth: "33.6",
      theme: "light",
      source: { "hair.color": "photo", bad: "nope" },
      futureField: { a: 1 },
    });
    expect(out.version).toBe(1);
    expect(out.vesselType).toBe("orb");
    expect(out.netForm).toBe("flame");
    expect(out.shape).toBe("slender");
    expect(out.hair).toEqual({ style: "braided", color: "#abcdef" });
    expect(out.eyes).toEqual({ shape: "closed", color: DEFAULT_CALIBRATION.eyes.color });
    expect(out.resonance).toEqual({ intensity: 100, glow: 0 });
    expect(out.silverWarmth).toBe(34);
    expect(out.theme).toBe("light");
    expect(out.source).toEqual({ "hair.color": "photo" });
    expect(out.futureField).toEqual({ a: 1 });
  });

  it("drops a humanoid netForm", () => {
    expect(normalizeVesselCalibration({ netForm: "humanoid" }).netForm).toBeUndefined();
  });

  it("a user edit marks the field 'user' and leaves photo fields alone", () => {
    const base = normalizeVesselCalibration({ source: { "eyes.color": "photo" } });
    const next = setCalibrationField(base, "hair.color", "#112233");
    expect(next.hair.color).toBe("#112233");
    expect(next.source).toEqual({ "eyes.color": "photo", "hair.color": "user" });
    expect(base.hair.color).toBe(DEFAULT_CALIBRATION.hair.color);
  });

  it("only Humanoid renders for now, but every type is selectable", () => {
    expect([...RENDERED_TYPES]).toEqual(["humanoid"]);
    expect(VESSEL_TYPES).toHaveLength(6);
  });

  it("silver tone runs cool platinum → warm moonlight", () => {
    expect(silverToneColor(0)).toBe("#d9e2ec");
    expect(silverToneColor(100)).toBe("#f1e4c8");
  });
});

describe("on-device essence store", () => {
  it("saves and reloads every vessel type's calibration per character", () => {
    const s = memStore();
    for (const t of VESSEL_TYPES) {
      const cal = setCalibrationField(DEFAULT_CALIBRATION, "vesselType", t);
      saveEssenceProfile(`c-${t}`, { name: " Serenity ", tagline: "t", calibration: cal, savedAt: null }, s, new Date("2026-11-23T00:00:00Z"));
      const back = loadEssenceProfile(`c-${t}`, "", s);
      expect(back.calibration.vesselType).toBe(t);
      expect(back.name).toBe("Serenity");
      expect(back.savedAt).toBe("2026-11-23T00:00:00.000Z");
    }
    expect(loadEssenceProfile("other", "Fallback", s).name).toBe("Fallback");
  });

  it("keeps reflections newest first, trims, and removes", () => {
    const s = memStore();
    expect(addReflectionDraft("c1", "   ", null, s)).toBeNull();
    addReflectionDraft("c1", " first ", "memory", s, new Date(1));
    const list = addReflectionDraft("c1", "second", null, s, new Date(2))!;
    expect(list.map((r) => r.text)).toEqual(["second", "first"]);
    expect(list[1].aspect).toBe("memory");
    expect(removeReflectionDraft("c1", list[0].id, s).map((r) => r.text)).toEqual(["first"]);
    expect(loadReflectionDrafts("c2", s)).toEqual([]);
  });

  it("survives corrupt storage", () => {
    const s = memStore();
    s.setItem("anima_essence_v1", "{not json");
    expect(loadEssenceProfile("c1", "N", s).calibration).toEqual(DEFAULT_CALIBRATION);
    expect(loadReflectionDrafts("c1", s)).toEqual([]);
  });
});

describe("patterns + routing helpers", () => {
  const d = (id: string, created_at: string, mood: string | null, themes: string[]) => ({ id, created_at, mood, themes, summary: "s", fragment: "f", read: false });
  const dreams = [d("1", "2026-11-23T10:00:00Z", "Dreamy", ["lantern", "hall"]), d("2", "2026-11-16T10:00:00Z", "dreamy", ["lantern"]), d("3", "2026-11-17T10:00:00Z", null, [])];

  it("tallies moods and themes case-insensitively", () => {
    expect(dreamMoods(dreams)).toEqual([{ label: "dreamy", count: 2 }]);
    expect(dreamThemes(dreams)[0]).toEqual({ label: "lantern", count: 2 });
  });

  it("buckets dreams per week", () => {
    const weeks = dreamsPerWeek(dreams, 3, new Date("2026-11-23T12:00:00Z"));
    expect(weeks.map((w) => w.count)).toEqual([0, 2, 1]);
  });

  it("keeps Dàvīn's screen order and defaults unknown screens to Calibrate", () => {
    expect(ESSENCE_SCREENS.map((s) => s.key)).toEqual(["calibrate", "vessel", "aspects", "reflections", "patterns"]);
    expect(essenceScreenOf("nope")).toBe("calibrate");
    expect(essencePath("a b", "patterns")).toBe("/essence/a%20b/patterns");
  });
});

describe("unknown-field cap (server calibration_unknown_bytes = 1024)", () => {
  const big = (n: number) => "x".repeat(n);

  it("keeps small unknown fields at the top level and inside hair/eyes/resonance", () => {
    const out = normalizeVesselCalibration({ aura: "soft", hair: { shine: 3 }, eyes: { sparkle: true }, resonance: { pulse: { hz: 2 } } });
    expect(out.aura).toBe("soft");
    expect(out.hair).toMatchObject({ shine: 3 });
    expect(out.eyes).toMatchObject({ sparkle: true });
    expect(out.resonance).toMatchObject({ pulse: { hz: 2 } });
    expect(unknownFieldBytes(out)).toBeLessThanOrEqual(CALIBRATION_UNKNOWN_BYTES);
  });

  it("caps serialized unknown fields at 1024 bytes, dropping extras deterministically by path", () => {
    const raw = { zeta: big(400), alpha: big(400), mid: big(400), tiny: 1 };
    const out = normalizeVesselCalibration(raw);
    // Sorted: alpha, mid, tiny, zeta. alpha+mid fit; tiny still fits; zeta would overflow.
    expect(Object.keys(out).filter((k) => ["alpha", "mid", "tiny", "zeta"].includes(k)).sort()).toEqual(["alpha", "mid", "tiny"]);
    expect(unknownFieldBytes(out)).toBeLessThanOrEqual(CALIBRATION_UNKNOWN_BYTES);
    // Key order of the input doesn't matter.
    const reordered = normalizeVesselCalibration({ tiny: 1, mid: big(400), zeta: big(400), alpha: big(400) });
    expect(JSON.stringify(reordered)).toBe(JSON.stringify(out));
    // Idempotent.
    expect(normalizeVesselCalibration(out)).toEqual(out);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const out = normalizeVesselCalibration({ a: "é".repeat(400), b: "é".repeat(400) });
    expect(out.a).toBeDefined();
    expect(out.b).toBeUndefined();
  });

  it("drops a single unknown field larger than the cap", () => {
    expect(normalizeVesselCalibration({ huge: big(2000) }).huge).toBeUndefined();
  });

  it("keeps at most 16 unknown keys", () => {
    const raw: Record<string, number> = {};
    for (let i = 0; i < 20; i++) raw[`k${String(i).padStart(2, "0")}`] = i;
    const out = normalizeVesselCalibration(raw);
    const kept = Object.keys(out).filter((k) => /^k\d\d$/.test(k)).sort();
    expect(kept).toHaveLength(16);
    expect(kept[15]).toBe("k15");
  });

  it("never carries name/tagline, bad keys, prototype keys, or too-deep values", () => {
    const raw = JSON.parse('{"name":"S","tagline":"t","__proto__":{"x":1},"constructor":1,"9bad":1,"bad-key":1,"deep":{"a":{"b":{"c":1}}},"ok":{"a":{"b":1}},"hair":{"deep":{"a":{"b":1}},"ok2":{"a":1},"flat":1}}');
    const out = normalizeVesselCalibration(raw);
    for (const k of ["name", "tagline", "constructor", "9bad", "bad-key", "deep"]) expect(Object.prototype.hasOwnProperty.call(out, k)).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(out, "__proto__")).toBe(false);
    expect(out.ok).toEqual({ a: { b: 1 } });
    expect(out.hair).toEqual({ style: "flowing", color: "#c8ccd4", flat: 1, ok2: { a: 1 } });
  });

  it("restricts source keys to known leaf paths and kept unknown paths", () => {
    const out = normalizeVesselCalibration({ aura: 1, source: { "hair.color": "photo", aura: "user", dropped: "user", "hair.nope": "user" } });
    expect(out.source).toEqual({ aura: "user", "hair.color": "photo" });
  });
});

describe("name and tagline rules (server: name 1–60, tagline 0–120)", () => {
  it("validates after trimming", () => {
    expect(validateEssenceIdentity("  Serenity ", "")).toEqual([]);
    expect(validateEssenceIdentity("   ", "")).toEqual(["invalid_name"]);
    expect(validateEssenceIdentity("x".repeat(60), "y".repeat(120))).toEqual([]);
    expect(validateEssenceIdentity("x".repeat(61), "y".repeat(121))).toEqual(["invalid_name", "invalid_tagline"]);
    expect(validateEssenceIdentity("Ser\u0007enity", "line\nbreak")).toEqual(["invalid_name", "invalid_tagline"]);
  });

  it("refuses to save an invalid name and ignores invalid stored values", () => {
    const s = memStore();
    expect(saveEssenceProfile("c1", { name: " ", tagline: "", calibration: DEFAULT_CALIBRATION, savedAt: null }, s)).toBeNull();
    expect(s.getItem("anima_essence_v1")).toBeNull();
    s.setItem("anima_essence_v1", JSON.stringify({ c1: { profile: { name: "x".repeat(61), tagline: "y".repeat(121) } } }));
    const back = loadEssenceProfile("c1", "Fallback", s);
    expect(back.name).toBe("Fallback");
    expect(back.tagline).toBe("");
  });
});
