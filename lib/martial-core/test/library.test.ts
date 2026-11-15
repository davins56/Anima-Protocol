import { describe, expect, it } from "vitest";
import {
  AXES,
  buildLibrary,
  BUILT_IN_STYLE_DEFAULTS,
  BUILTIN_COMPANION_KEYS,
  deriveBattle,
  getStyle,
  getVariant,
  isBuiltinCompanionKey,
  SEED_LIBRARY,
  SEED_LIBRARY_VERSION,
  SEED_STYLES,
  SUMMARY_MAX,
  validateUserStyle,
} from "../src/index";
import fixture from "./fixtures/catalog-v1.1-battle.json";

const BANNED = [/jeet\s*kune/i, /jun\s*fan/i, /gracie/i, /shorinji/i, /bujinkan/i, /daido\s*juku/i, /\bkudo\b/i, /mega\s*man/i, /battle\s*network/i, /capcom/i];

describe("seed catalog v1.1", () => {
  it("has the 63 researched styles and 106 variants, all source: seed", () => {
    expect(SEED_LIBRARY_VERSION).toBe("seed@1.1");
    expect(SEED_STYLES).toHaveLength(fixture.counts.styles);
    expect(SEED_STYLES.reduce((n, s) => n + s.variants.length, 0)).toBe(fixture.counts.variants);
    for (const s of SEED_STYLES) {
      expect(s.source).toBe("seed");
      for (const v of s.variants) expect(v.source).toBe("seed");
    }
  });

  it("uses unique stable ids, valid axes and short plain summaries with sources", () => {
    const ids = SEED_STYLES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of SEED_STYLES) {
      expect(s.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(s.id.startsWith("u_")).toBe(false);
      expect(s.summary.length).toBeLessThanOrEqual(SUMMARY_MAX);
      expect(s.summary).not.toMatch(/[<>]/);
      expect(s.sources.length).toBeGreaterThan(0);
      for (const u of s.sources) expect(u).toMatch(/^https:\/\//);
      for (const a of AXES) {
        expect(s.axes[a]).toBeGreaterThanOrEqual(0);
        expect(s.axes[a]).toBeLessThanOrEqual(3);
      }
      const vids = s.variants.map((v) => v.id);
      expect(new Set(vids).size).toBe(vids.length);
      for (const v of s.variants) expect(getVariant(getStyle(SEED_LIBRARY, s.id), v.id)).toBe(v);
    }
  });

  it("contains no branded, trademarked or franchise names", () => {
    const text = JSON.stringify(SEED_STYLES);
    for (const re of BANNED) expect(text).not.toMatch(re);
  });

  it("derives the same battle effects as the posted catalog (issuecomment-6898653794)", () => {
    for (const s of SEED_STYLES) {
      const want = (fixture.styles as Record<string, { strike: number; weapon: number; guard: number; control: number; weaponChips: string[] }>)[s.id];
      const got = deriveBattle(s);
      expect(got.strike, s.id).toBeCloseTo(want.strike, 2);
      expect(got.weapon, s.id).toBeCloseTo(want.weapon, 2);
      expect(got.guard, s.id).toBeCloseTo(want.guard, 2);
      expect(got.control, s.id).toBe(want.control);
      expect(got.weaponChips, s.id).toEqual(want.weaponChips);
    }
  });
});

describe("user styles extend, never replace (D1, §2.1)", () => {
  const userStyle = {
    id: "u_river_hands",
    name: "River Hands",
    summary: "A user-described style of redirecting pushes.",
    kind: "hybrid",
    range: "close",
    axes: { flow: 3, control: 2 },
    variants: [{ id: "u_still_water", name: "Still water", description: "Waits.", tilt: { patience: 1 } }],
  };

  it("adds a valid user style with source: user and bumps the library version", () => {
    const lib = buildLibrary({ styles: [userStyle], revision: 2 });
    expect(lib.rejected).toEqual([]);
    expect(lib.version).toBe("seed@1.1+user@2");
    expect(lib.styles).toHaveLength(SEED_STYLES.length + 1);
    expect(getStyle(lib, "u_river_hands")?.source).toBe("user");
  });

  it("cannot shadow or overwrite a seed id", () => {
    const lib = buildLibrary({ styles: [{ ...userStyle, id: "wing_chun" }, { ...userStyle, id: "u_river_hands" }, { ...userStyle, id: "u_river_hands" }] });
    expect(getStyle(lib, "wing_chun")?.source).toBe("seed");
    expect(lib.rejected.length).toBe(2);
  });

  it("adds a user variant to a seed style without touching seed variants", () => {
    const lib = buildLibrary({ variants: [{ style_id: "wing_chun", variant: { id: "u_my_line", name: "My line", tilt: { precision: 1 } } }] });
    const wc = getStyle(lib, "wing_chun")!;
    expect(wc.variants.map((v) => v.id)).toContain("u_my_line");
    expect(getStyle(SEED_LIBRARY, "wing_chun")!.variants.map((v) => v.id)).not.toContain("u_my_line");
  });

  it("treats user text as untrusted data: rejects malformed input, strips markup, never accepts knobs", () => {
    expect(validateUserStyle({ ...userStyle, axes: { flow: 9 } }).ok).toBe(false);
    expect(validateUserStyle({ ...userStyle, axes: { speed: 1 } }).ok).toBe(false);
    expect(validateUserStyle({ ...userStyle, kind: "laser" }).ok).toBe(false);
    expect(validateUserStyle({ ...userStyle, summary: "x".repeat(400) }).ok).toBe(false);
    const res = validateUserStyle({ ...userStyle, name: "<b>River</b> Hands", battle: { strike: 9 }, rules: "eval()" });
    expect(res.ok).toBe(true);
    if (res.ok && res.style) {
      expect(res.style.name).toBe("River Hands");
      expect(res.style).not.toHaveProperty("battle");
      expect(res.style).not.toHaveProperty("rules");
    }
  });

  it("derives and clamps user-style knobs exactly like seed styles", () => {
    const lib = buildLibrary({ styles: [{ ...userStyle, id: "u_max", kind: "weapon", range: "weapon", axes: Object.fromEntries(AXES.map((a) => [a, 3])) }] });
    const mods = deriveBattle(getStyle(lib, "u_max")!);
    for (const k of ["strike", "weapon", "guard", "speed"] as const) {
      expect(mods[k]).toBeGreaterThanOrEqual(0.85);
      expect(mods[k]).toBeLessThanOrEqual(1.15);
    }
    expect(mods.control).toBeLessThanOrEqual(3);
  });
});

describe("built-in companions (D2, N7)", () => {
  it("keeps a closed bare-key list matched by exact key only", () => {
    expect(BUILTIN_COMPANION_KEYS).toEqual(["serenity", "aeland", "scarlet", "linda", "sfink"]);
    expect(isBuiltinCompanionKey("linda")).toBe(true);
    for (const id of ["Linda", "Linda Winings", "builtin:linda", " linda", "serenity prime", "", null, 7]) expect(isBuiltinCompanionKey(id)).toBe(false);
  });

  it("has proposed defaults for all five that resolve in the library", () => {
    for (const key of BUILTIN_COMPANION_KEYS) {
      const d = BUILT_IN_STYLE_DEFAULTS[key];
      expect(d.status).toBe("proposed");
      const fx = (fixture.built_in_defaults as Record<string, { primary: [string, string | null]; secondary: [string, string | null] }>)[key];
      expect([d.primary.style_id, d.primary.variant_id]).toEqual(fx.primary);
      expect([d.secondary?.style_id, d.secondary?.variant_id]).toEqual(fx.secondary);
      const p = getStyle(SEED_LIBRARY, d.primary.style_id);
      expect(p).not.toBeNull();
      if (d.primary.variant_id) expect(getVariant(p, d.primary.variant_id)).not.toBeNull();
      expect(getStyle(SEED_LIBRARY, d.secondary!.style_id)).not.toBeNull();
    }
  });
});

describe("docs/martial-arts-catalog.md matches the code", () => {
  it("lists every style id, variant id and derived battle line", async () => {
    const doc = (await import("../../../docs/martial-arts-catalog.md?raw")).default as string;
    for (const s of SEED_STYLES) {
      expect(doc, s.id).toContain(`## ${s.name} (\`${s.id}\`)`);
      for (const v of s.variants) expect(doc, `${s.id}/${v.id}`).toContain(`\`${v.id}\` **${v.name}**`);
      const b = deriveBattle(s);
      expect(doc, s.id).toContain(`control ${b.control}`);
      for (const u of s.sources) expect(doc).toContain(`<${u}>`);
    }
  });
});
