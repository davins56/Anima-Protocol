/**
 * vesselCalibration v1: the canonical client module for Anima Essence's
 * Calibrate settings (3D Visual owns it; the Calibrate screen re-exports it).
 *
 * Stored server-side at character_vessel.config.calibration and returned by
 * GET /api/vessel/:id under vessel.config.calibration (Backend Data, no
 * migration). Shape:
 *
 *   { version: 1, vesselType, netForm?, shape, hair:{style,color}, eyes:{shape,color},
 *     resonance:{intensity,glow}, silverWarmth, theme, source:{[leafPath]: default|photo|user} }
 *
 * Name and tagline are NOT part of it (they live on the character's entry).
 *
 * Validation: the shared pure package `lib/vessel-calibration` (Backend Data)
 * is the server's write-side validator. It has not landed on main yet, so this
 * module carries the read-side normalizer, written to the same rules (exact
 * enums, `#rrggbb` lowercase, 0-100 rounded, lenient read: clamp + defaults,
 * never throws). When the package lands, `normalizeVesselCalibration` should
 * delegate to its read normalizer and the enum lists should be re-exported
 * from it; the exports below stay the same so callers don't change.
 *
 * PRECEDENCE (decision, Nov 2026): a calibration field drives rendering only
 * when its source is `user`. Otherwise the existing `config.hair` /
 * `config.eyes` / body / effects (from the photo-to-vessel creator, Vessel
 * Studio or presets) win. Essence never rewrites `config.hair` or
 * `config.eyes`; the override happens only at render time, in
 * `resolveCalibratedLook`.
 *
 * No three.js here: pure data, safe to import anywhere (tests, server mirrors).
 */
import type { VesselConfig } from "./vesselConfig";

export const CALIBRATION_VERSION = 1 as const;

export const VESSEL_TYPES = ["humanoid", "crystal", "orb", "chalice", "flame", "tree"] as const;
export const NET_FORMS = ["crystal", "orb", "chalice", "flame", "tree"] as const;
export const VESSEL_SHAPES = ["slender", "curved", "tall", "compact"] as const;
export const HAIR_STYLES = ["flowing", "long", "short", "braided", "none"] as const;
export const EYE_SHAPES = ["almond", "round", "narrow", "closed"] as const;
export const THEMES = ["dark", "light"] as const;
export const CALIBRATION_SOURCES = ["default", "photo", "user"] as const;

export type VesselType = (typeof VESSEL_TYPES)[number];
export type NetForm = (typeof NET_FORMS)[number];
export type VesselShape = (typeof VESSEL_SHAPES)[number];
export type CalibrationHairStyle = (typeof HAIR_STYLES)[number];
export type EyeShape = (typeof EYE_SHAPES)[number];
export type StageTheme = (typeof THEMES)[number];
export type CalibrationSource = (typeof CALIBRATION_SOURCES)[number];

/** Known leaf paths (the keys of the `source` map). */
export const CALIBRATION_PATHS = [
  "vesselType",
  "netForm",
  "shape",
  "hair.style",
  "hair.color",
  "eyes.shape",
  "eyes.color",
  "resonance.intensity",
  "resonance.glow",
  "silverWarmth",
  "theme",
] as const;
export type CalibrationPath = (typeof CALIBRATION_PATHS)[number];

export type VesselCalibration = {
  version: 1;
  vesselType: VesselType;
  netForm?: NetForm;
  shape: VesselShape;
  hair: { style: CalibrationHairStyle; color: string };
  eyes: { shape: EyeShape; color: string };
  resonance: { intensity: number; glow: number };
  /** 0 = cool platinum, 100 = warm moonlight. */
  silverWarmth: number;
  /** Per-vessel stage theme; separate from the app Color Theme. */
  theme: StageTheme;
  /** Written by the server; per leaf path. */
  source: Partial<Record<string, CalibrationSource>>;
  /** Unknown fields from a newer client are kept, never dropped. */
  [extra: string]: unknown;
};

/* ---------- display labels: one source of truth for the screen ---------- */

export type Option<T extends string> = { value: T; label: string; blurb?: string };

export const VESSEL_TYPE_OPTIONS: readonly Option<VesselType>[] = [
  { value: "humanoid", label: "Humanoid", blurb: "Her familiar form." },
  { value: "crystal", label: "Crystal", blurb: "Faceted light, held still." },
  { value: "orb", label: "Orb", blurb: "A sphere of quiet resonance." },
  { value: "chalice", label: "Chalice", blurb: "A vessel that holds what is poured in." },
  { value: "flame", label: "Flame", blurb: "Restless, warm, never the same twice." },
  { value: "tree", label: "Tree", blurb: "Rooted, slow, growing toward the light." },
];
export const NET_FORM_OPTIONS: readonly Option<NetForm>[] = VESSEL_TYPE_OPTIONS.filter((o): o is Option<NetForm> => o.value !== "humanoid");
export const SHAPE_OPTIONS: readonly Option<VesselShape>[] = [
  { value: "slender", label: "Slender" },
  { value: "curved", label: "Curved" },
  { value: "tall", label: "Tall" },
  { value: "compact", label: "Compact" },
];
export const HAIR_STYLE_OPTIONS: readonly Option<CalibrationHairStyle>[] = [
  { value: "flowing", label: "Flowing" },
  { value: "long", label: "Long" },
  { value: "short", label: "Short" },
  { value: "braided", label: "Braided" },
  { value: "none", label: "None" },
];
export const EYE_SHAPE_OPTIONS: readonly Option<EyeShape>[] = [
  { value: "almond", label: "Almond" },
  { value: "round", label: "Round" },
  { value: "narrow", label: "Narrow" },
  { value: "closed", label: "Closed" },
];
export const THEME_OPTIONS: readonly Option<StageTheme>[] = [
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

export function labelOf<T extends string>(options: readonly Option<T>[], value: T): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * Which Calibrate controls change the rendered vessel, per form. Controls not
 * listed are still saved (they come back if she returns to that form).
 */
export type CalibrationControl = "shape" | "hair.style" | "hair.color" | "eyes.shape" | "eyes.color" | "resonance.intensity" | "resonance.glow" | "silverWarmth" | "theme" | "netForm";
const SHARED: CalibrationControl[] = ["eyes.color", "resonance.intensity", "resonance.glow", "silverWarmth", "theme", "netForm"];
export const CONTROLS_BY_FORM: Readonly<Record<VesselType, readonly CalibrationControl[]>> = {
  humanoid: ["shape", "hair.style", "hair.color", "eyes.shape", ...SHARED],
  crystal: SHARED,
  orb: SHARED,
  chalice: SHARED,
  flame: SHARED,
  tree: SHARED,
};
export function controlApplies(form: VesselType, control: CalibrationControl): boolean {
  return CONTROLS_BY_FORM[form].includes(control);
}

/* ---------- defaults + normalizer ---------- */

export const DEFAULT_CALIBRATION: Readonly<VesselCalibration> = Object.freeze({
  version: 1,
  vesselType: "humanoid",
  shape: "slender",
  hair: Object.freeze({ style: "flowing", color: "#c8ccd4" }) as VesselCalibration["hair"],
  eyes: Object.freeze({ shape: "almond", color: "#3b82f6" }) as VesselCalibration["eyes"],
  resonance: Object.freeze({ intensity: 60, glow: 50 }) as VesselCalibration["resonance"],
  silverWarmth: 50,
  theme: "dark",
  source: Object.freeze({}) as VesselCalibration["source"],
}) as Readonly<VesselCalibration>;

const HEX = /^#[0-9a-f]{6}$/i;
const UNKNOWN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
/** Never part of calibration (they have one home on the character's entry). */
const EXCLUDED_KEYS = new Set(["name", "tagline"]);
const KNOWN_TOP = new Set(["version", "vesselType", "netForm", "shape", "hair", "eyes", "resonance", "silverWarmth", "theme", "source"]);
const MAX_UNKNOWN_KEYS = 16;
const MAX_UNKNOWN_BYTES = 1024;

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  if (typeof v !== "string") return fallback;
  const s = v.trim().toLowerCase();
  return (list as readonly string[]).includes(s) ? (s as T) : fallback;
}

/** 0-100, rounded to a whole number; non-finite falls back. */
export function clamp100(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(100, Math.max(0, n)));
}

/** `#rrggbb` (any case) → lowercase; anything else (#rgb, #rrggbbaa, names) falls back. */
export function normalizeHex(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}

function depthOk(v: unknown, depth: number): boolean {
  if (!v || typeof v !== "object") return true;
  if (depth >= 3) return false;
  return Object.values(v as Record<string, unknown>).every((x) => depthOk(x, depth + 1));
}

/** Keep unknown fields the server would keep (key regex, depth ≤ 3, ≤ 16 keys, ≤ 1 KB). */
function unknownFields(r: Record<string, unknown>, known: Set<string>, budget: { keys: number; bytes: number }, depth: number) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (known.has(k) || EXCLUDED_KEYS.has(k) || FORBIDDEN_KEYS.has(k) || !UNKNOWN_KEY.test(k)) continue;
    if (v === undefined || typeof v === "function" || !depthOk(v, depth)) continue;
    let bytes = 0;
    try {
      bytes = JSON.stringify(v).length + k.length;
    } catch {
      continue;
    }
    if (budget.keys + 1 > MAX_UNKNOWN_KEYS || budget.bytes + bytes > MAX_UNKNOWN_BYTES) continue;
    budget.keys += 1;
    budget.bytes += bytes;
    out[k] = v;
  }
  return out;
}

/**
 * Read-side normalizer: validates hex, clamps and rounds 0-100, exact enums
 * (case-folded), falls back to defaults, keeps bounded unknown fields, drops
 * name/tagline. Never throws. `null`/non-objects give a fresh default.
 */
export function normalizeVesselCalibration(raw: unknown): VesselCalibration {
  const r = obj(raw);
  const d = DEFAULT_CALIBRATION;
  const hair = obj(r.hair);
  const eyes = obj(r.eyes);
  const res = obj(r.resonance);
  const budget = { keys: 0, bytes: 0 };
  const source: Record<string, CalibrationSource> = {};
  let n = 0;
  for (const [k, v] of Object.entries(obj(r.source))) {
    if (n >= 32 || FORBIDDEN_KEYS.has(k)) continue;
    if (v === "photo" || v === "user" || v === "default") {
      source[k] = v;
      n++;
    }
  }
  const out: VesselCalibration = {
    ...unknownFields(r, KNOWN_TOP, budget, 1),
    version: 1,
    vesselType: oneOf(VESSEL_TYPES, r.vesselType, d.vesselType),
    shape: oneOf(VESSEL_SHAPES, r.shape, d.shape),
    hair: {
      ...unknownFields(hair, new Set(["style", "color"]), budget, 2),
      style: oneOf(HAIR_STYLES, hair.style, d.hair.style),
      color: normalizeHex(hair.color, d.hair.color),
    },
    eyes: {
      ...unknownFields(eyes, new Set(["shape", "color"]), budget, 2),
      shape: oneOf(EYE_SHAPES, eyes.shape, d.eyes.shape),
      color: normalizeHex(eyes.color, d.eyes.color),
    },
    resonance: {
      ...unknownFields(res, new Set(["intensity", "glow"]), budget, 2),
      intensity: clamp100(res.intensity, d.resonance.intensity),
      glow: clamp100(res.glow, d.resonance.glow),
    },
    silverWarmth: clamp100(r.silverWarmth, d.silverWarmth),
    theme: oneOf(THEMES, r.theme, d.theme),
    source,
  };
  const net = oneOf<NetForm | "none">([...NET_FORMS, "none"], r.netForm, "none");
  if (net !== "none") out.netForm = net;
  return out;
}

/** Fresh mutable default (DEFAULT_CALIBRATION is frozen). */
export function defaultCalibration(): VesselCalibration {
  return normalizeVesselCalibration({});
}

/**
 * Local edit at `path` (e.g. "hair.color"), marked `user` in the source map
 * for previews. The server re-derives the real source map on save.
 */
export function setCalibrationField(cal: VesselCalibration, path: string, value: unknown): VesselCalibration {
  const next = JSON.parse(JSON.stringify(cal)) as Record<string, unknown>;
  const parts = path.split(".");
  if (parts.some((p) => FORBIDDEN_KEYS.has(p))) return normalizeVesselCalibration(cal);
  let cur = next;
  for (const p of parts.slice(0, -1)) {
    cur[p] = obj(cur[p]);
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
  const normalized = normalizeVesselCalibration(next);
  normalized.source = { ...normalized.source, [path]: "user" };
  return normalized;
}

/* ---------- precedence + mapping onto the existing vessel ---------- */

export function sourceOf(cal: VesselCalibration | null | undefined, path: CalibrationPath | string): CalibrationSource {
  return (cal?.source?.[path] as CalibrationSource | undefined) ?? "default";
}

/** A calibration field drives rendering only when the user set it. */
export function isUserSet(cal: VesselCalibration | null | undefined, path: CalibrationPath | string): boolean {
  return sourceOf(cal, path) === "user";
}

/**
 * Calibration hair style → the existing procedural hair meshes
 * (VesselConfig HAIR_STYLES long|bob|pixie|braid|ponytail|wild|bun).
 *   flowing → long (+ gentle sway), long → long, short → bob,
 *   braided → braid, none → hair hidden.
 */
export const HAIR_STYLE_TO_MESH: Readonly<Record<CalibrationHairStyle, VesselConfig["hair"]["style"] | null>> = {
  flowing: "long",
  long: "long",
  short: "bob",
  braided: "braid",
  none: null,
};
export function hairMeshFor(style: CalibrationHairStyle): { style: VesselConfig["hair"]["style"] | null; sway: number } {
  return { style: HAIR_STYLE_TO_MESH[style], sway: style === "flowing" ? 1 : 0 };
}

/** Calibration shape → existing procedural body proportions (VesselConfig bodyType). */
export const SHAPE_TO_BODY: Readonly<Record<VesselShape, VesselConfig["bodyType"]>> = {
  slender: "slender",
  curved: "curvy",
  tall: "tall",
  compact: "petite",
};

/** Silver Tone warmth: 0 = cool platinum, 100 = warm moonlight. */
export const SILVER_COOL = "#d9e2ec";
export const SILVER_WARM = "#f1e4c8";
export function silverToneColor(warmth: number): string {
  const t = Math.min(100, Math.max(0, Number(warmth) || 0)) / 100;
  const a = [0xd9, 0xe2, 0xec];
  const b = [0xf1, 0xe4, 0xc8];
  return `#${a.map((c, i) => Math.round(c + (b[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** Stage background + light rig for a per-vessel theme (not the app Color Theme). */
export type StageLook = { background: string; ambient: number; key: number; rim: number; fog: string };
export const STAGES: Readonly<Record<StageTheme, StageLook>> = {
  dark: { background: "radial-gradient(ellipse at 50% 30%, #12203f 0%, #050a18 60%, #020617 100%)", ambient: 0.55, key: 1.1, rim: 0.7, fog: "#020617" },
  light: { background: "radial-gradient(ellipse at 50% 30%, #ffffff 0%, #e7ecf5 55%, #cfd8e6 100%)", ambient: 1.0, key: 1.35, rim: 0.35, fog: "#e7ecf5" },
};

/** What the renderer applies, after precedence. Every override is `null` when not user-set. */
export type CalibratedLook = {
  /** Rendered form (humanoid unless the user picked another). */
  form: VesselType;
  /** Form used in Cyberworld / net surfaces, or null to keep the usual net figure. */
  netForm: NetForm | null;
  /** Effective config: config.hair / eyes / bodyType replaced at render time only where user-set. */
  config: VesselConfig;
  hairHidden: boolean;
  /** 0..1 extra sway for "flowing" hair. */
  hairSway: number;
  eyeShape: EyeShape | null;
  /** Core / eye tint for every form. */
  coreColor: string;
  /** Sapphire Resonance intensity → aura strength 0..1 (null = no calibration aura). */
  aura: number | null;
  /** Glow strength → emissive 0..1 (null = keep the vessel's own). */
  glow: number | null;
  /** Silver / metal tint (null = keep). */
  silver: string | null;
  theme: StageTheme | null;
  calibration: VesselCalibration | null;
};

/** Sapphire blue used for the resonance aura. */
export const SAPPHIRE = "#2563eb";

/**
 * Apply precedence: calibration drives a field only when its source is `user`.
 * Pure; returns `config` itself (same reference) when nothing applies, so
 * memoized hosts don't re-render.
 */
export function resolveCalibratedLook(config: VesselConfig, calibrationOverride?: unknown): CalibratedLook {
  const raw = calibrationOverride !== undefined ? calibrationOverride : (config as VesselConfig & { calibration?: unknown }).calibration;
  const cal = raw == null ? null : normalizeVesselCalibration(raw);
  const u = (p: CalibrationPath) => isUserSet(cal, p);
  const form: VesselType = cal && u("vesselType") ? cal.vesselType : "humanoid";
  const netForm: NetForm | null = cal && u("netForm") && cal.netForm ? cal.netForm : form !== "humanoid" ? (form as NetForm) : null;

  let effective = config;
  let hairHidden = false;
  let hairSway = 0;
  if (cal) {
    const patch: Partial<VesselConfig> = {};
    if (u("shape")) patch.bodyType = SHAPE_TO_BODY[cal.shape];
    if (u("hair.style") || u("hair.color")) {
      const hair = { ...config.hair };
      if (u("hair.style")) {
        const m = hairMeshFor(cal.hair.style);
        if (m.style) hair.style = m.style;
        hairHidden = m.style === null;
        hairSway = m.sway;
      }
      if (u("hair.color")) hair.color = cal.hair.color;
      patch.hair = hair;
    }
    if (u("eyes.color") || u("resonance.glow")) {
      patch.eyes = {
        color: u("eyes.color") ? cal.eyes.color : config.eyes.color,
        glow: u("resonance.glow") ? cal.resonance.glow / 100 : config.eyes.glow,
      };
    }
    if (Object.keys(patch).length) effective = { ...config, ...patch };
  }

  return {
    form,
    netForm,
    config: effective,
    hairHidden,
    hairSway,
    eyeShape: cal && u("eyes.shape") ? cal.eyes.shape : null,
    coreColor: effective.eyes.color,
    aura: cal && u("resonance.intensity") ? cal.resonance.intensity / 100 : null,
    glow: cal && u("resonance.glow") ? cal.resonance.glow / 100 : null,
    silver: cal && u("silverWarmth") ? silverToneColor(cal.silverWarmth) : null,
    theme: cal && u("theme") ? cal.theme : null,
    calibration: cal,
  };
}

/** Eye mesh scale per shape (x = width, y = height); `closed` shuts the lids. */
export const EYE_SHAPE_SCALE: Readonly<Record<EyeShape, readonly [number, number]>> = {
  almond: [1.25, 0.72],
  round: [1.1, 1.1],
  narrow: [1.35, 0.42],
  closed: [1.2, 0.08],
};
