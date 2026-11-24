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
 * never throws). Unknown fields are kept only within the server's caps
 * (design §4.7: key regex, depth ≤ 3, ≤ 16 keys, ≤ 1024 UTF-8 bytes of
 * serialized JSON), chosen deterministically in path order; anything over the
 * caps is dropped. `source` keys are limited to known leaf paths and kept
 * unknown paths (§4.8), at most 32, in path order. When the package lands, `normalizeVesselCalibration` should
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
  /** Unknown fields from a newer client, kept within the server's caps (see normalizeVesselCalibration). */
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
const KNOWN_NESTED: Readonly<Record<"hair" | "eyes" | "resonance", ReadonlySet<string>>> = {
  hair: new Set(["style", "color"]),
  eyes: new Set(["shape", "color"]),
  resonance: new Set(["intensity", "glow"]),
};

/** Server caps (design §4.7 / §4.8); over them the server answers 413 calibration_too_large. */
export const CALIBRATION_UNKNOWN_BYTES = 1024;
export const CALIBRATION_UNKNOWN_KEYS = 16;
export const CALIBRATION_MAX_DEPTH = 3;
export const CALIBRATION_SOURCE_MAX = 32;

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

/** Code-unit order: the same on every engine and on the server. */
const byPath = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** UTF-8 byte length (what the server measures), without TextEncoder. */
export function utf8ByteLength(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && (s.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * JSON nesting depth (primitives 0, `{}`/`[]` 1, ...), counted only up to
 * `limit + 1`: deep junk is rejected without recursing through all of it.
 */
function jsonDepth(v: unknown, limit: number): number {
  if (!v || typeof v !== "object") return 0;
  if (limit <= 0) return 1;
  const kids = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
  let max = 0;
  for (const k of kids) {
    max = Math.max(max, jsonDepth(k, limit - 1));
    if (max >= limit) break;
  }
  return 1 + max;
}

/** A JSON round-trip copy, or undefined for values JSON can't carry. */
function jsonSafe(v: unknown): unknown {
  try {
    const text = JSON.stringify(v);
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

type UnknownEntry = { path: string; parent: "hair" | "eyes" | "resonance" | null; key: string; value: unknown };

function collectUnknown(r: Record<string, unknown>): UnknownEntry[] {
  const out: UnknownEntry[] = [];
  const consider = (parent: UnknownEntry["parent"], key: string, raw: unknown) => {
    if (FORBIDDEN_KEYS.has(key) || EXCLUDED_KEYS.has(key) || !UNKNOWN_KEY.test(key)) return;
    // Whole calibration depth ≤ 3: the root object is 1, a top-level key's object value 2.
    const allowed = CALIBRATION_MAX_DEPTH - (parent ? 2 : 1);
    let value: unknown;
    try {
      // Depth first (bounded), so deeply nested junk never reaches JSON.stringify.
      // try: a throwing getter / proxy trap drops the field instead of the read.
      if (jsonDepth(raw, allowed) > allowed) return;
      value = jsonSafe(raw);
      if (value === undefined || jsonDepth(value, allowed) > allowed) return;
    } catch {
      return;
    }
    out.push({ path: parent ? `${parent}.${key}` : key, parent, key, value });
  };
  for (const k of Object.keys(r)) if (!KNOWN_TOP.has(k)) consider(null, k, r[k]);
  for (const parent of ["hair", "eyes", "resonance"] as const) {
    const o = obj(r[parent]);
    for (const k of Object.keys(o)) if (!KNOWN_NESTED[parent].has(k)) consider(parent, k, o[k]);
  }
  return out;
}

function unknownTree(entries: readonly UnknownEntry[]): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const e of entries) {
    if (!e.parent) tree[e.key] = e.value;
    else tree[e.parent] = { ...obj(tree[e.parent]), [e.key]: e.value };
  }
  return tree;
}

/**
 * Which unknown fields survive. Deterministic: candidates sorted by path, then
 * taken greedily while the serialized unknown fields stay ≤ 1024 UTF-8 bytes
 * and ≤ 16 keys. A field that would overflow is dropped; later, smaller ones
 * may still fit. Same input → same output, whatever the original key order.
 */
function capUnknown(entries: readonly UnknownEntry[]): UnknownEntry[] {
  const sorted = [...entries].sort((a, b) => byPath(a.path, b.path));
  const kept: UnknownEntry[] = [];
  for (const e of sorted) {
    if (kept.length >= CALIBRATION_UNKNOWN_KEYS) break;
    if (utf8ByteLength(JSON.stringify(unknownTree([...kept, e]))) <= CALIBRATION_UNKNOWN_BYTES) kept.push(e);
  }
  return kept;
}

/** Serialized UTF-8 size of a calibration's unknown fields, as the server counts them. */
export function unknownFieldBytes(cal: unknown): number {
  return utf8ByteLength(JSON.stringify(unknownTree(collectUnknown(obj(cal)))));
}

/**
 * Read-side normalizer: validates hex, clamps and rounds 0-100, exact enums
 * (case-folded), falls back to defaults, drops name/tagline. Unknown fields
 * are kept only within the server caps (sorted by path; over the caps they
 * are dropped). `source` keeps only known leaf paths and kept unknown paths,
 * ≤ 32 in path order. Never throws. `null`/non-objects give a fresh default.
 */
export function normalizeVesselCalibration(raw: unknown): VesselCalibration {
  const r = obj(raw);
  const d = DEFAULT_CALIBRATION;
  const hair = obj(r.hair);
  const eyes = obj(r.eyes);
  const res = obj(r.resonance);
  const kept = capUnknown(collectUnknown(r));
  const extras = unknownTree(kept);
  const allowedSource = new Set<string>([...CALIBRATION_PATHS, ...kept.map((e) => e.path)]);
  const source: Record<string, CalibrationSource> = {};
  let n = 0;
  const rawSource = obj(r.source);
  for (const k of Object.keys(rawSource).sort(byPath)) {
    if (n >= CALIBRATION_SOURCE_MAX) break;
    const v = rawSource[k];
    if (allowedSource.has(k) && (v === "photo" || v === "user" || v === "default")) {
      source[k] = v;
      n++;
    }
  }
  const out: VesselCalibration = {
    ...extras,
    version: 1,
    vesselType: oneOf(VESSEL_TYPES, r.vesselType, d.vesselType),
    shape: oneOf(VESSEL_SHAPES, r.shape, d.shape),
    hair: {
      ...obj(extras.hair),
      style: oneOf(HAIR_STYLES, hair.style, d.hair.style),
      color: normalizeHex(hair.color, d.hair.color),
    },
    eyes: {
      ...obj(extras.eyes),
      shape: oneOf(EYE_SHAPES, eyes.shape, d.eyes.shape),
      color: normalizeHex(eyes.color, d.eyes.color),
    },
    resonance: {
      ...obj(extras.resonance),
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
