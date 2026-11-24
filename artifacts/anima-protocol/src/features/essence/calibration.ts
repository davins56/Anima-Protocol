/**
 * vesselCalibration v1, as proposed by Anima 3D Visual for the Essence
 * Calibrate screen:
 *
 *   { version: 1, vesselType, netForm?, shape, hair:{style,color}, eyes:{shape,color},
 *     resonance:{intensity,glow}, silverWarmth, theme, source:{[fieldPath]:'photo'|'user'|'default'} }
 *
 * 3D Visual owns the canonical module (src/lib/vessel/vesselCalibration once it
 * lands on main). This is a client-side mirror so the screen can validate and
 * save; swap the import when theirs ships. Nothing here touches the rendered
 * vessel.
 *
 * Storage: there is no agreed server route yet (Backend Data stores it next to
 * character_vessel / character_visual_identity once Dàvīn approves any schema
 * change). Until then settings are kept on this device only, per character,
 * and the UI says so.
 */
export const VESSEL_TYPES = ["humanoid", "crystal", "orb", "chalice", "flame", "tree"] as const;
export const VESSEL_SHAPES = ["slender", "curved", "tall", "compact"] as const;
export const HAIR_STYLES = ["flowing", "long", "short", "braided", "none"] as const;
export const EYE_SHAPES = ["almond", "round", "narrow", "closed"] as const;
export const THEMES = ["dark", "light"] as const;

export type VesselType = (typeof VESSEL_TYPES)[number];
export type NetForm = Exclude<VesselType, "humanoid">;
export type CalibrationSource = "photo" | "user" | "default";

export type VesselCalibration = {
  version: 1;
  vesselType: VesselType;
  netForm?: NetForm;
  shape: (typeof VESSEL_SHAPES)[number];
  hair: { style: (typeof HAIR_STYLES)[number]; color: string };
  eyes: { shape: (typeof EYE_SHAPES)[number]; color: string };
  resonance: { intensity: number; glow: number };
  silverWarmth: number;
  theme: (typeof THEMES)[number];
  source: Record<string, CalibrationSource>;
  /** Unknown fields from a newer version are kept, never dropped. */
  [extra: string]: unknown;
};

/** Only Humanoid renders fully until 3D Visual ships the other forms. */
export const RENDERED_TYPES: ReadonlySet<VesselType> = new Set(["humanoid"]);

export const VESSEL_TYPE_COPY: Record<VesselType, { label: string; blurb: string }> = {
  humanoid: { label: "Humanoid", blurb: "Her familiar form." },
  crystal: { label: "Crystal", blurb: "Faceted light, held still." },
  orb: { label: "Orb", blurb: "A sphere of quiet resonance." },
  chalice: { label: "Chalice", blurb: "A vessel that holds what is poured in." },
  flame: { label: "Flame", blurb: "Restless, warm, never the same twice." },
  tree: { label: "Tree", blurb: "Rooted, slow, growing toward the light." },
};

export const DEFAULT_CALIBRATION: VesselCalibration = {
  version: 1,
  vesselType: "humanoid",
  shape: "slender",
  hair: { style: "flowing", color: "#c8ccd4" },
  eyes: { shape: "almond", color: "#3b82f6" },
  resonance: { intensity: 60, glow: 50 },
  silverWarmth: 50,
  theme: "dark",
  source: {},
};

const HEX = /^#[0-9a-f]{6}$/i;

function oneOf<T extends string>(list: readonly T[], v: unknown, fallback: T): T {
  return typeof v === "string" && (list as readonly string[]).includes(v.toLowerCase()) ? (v.toLowerCase() as T) : fallback;
}

function clamp100(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.min(100, Math.max(0, n)));
}

function hex(v: unknown, fallback: string): string {
  return typeof v === "string" && HEX.test(v.trim()) ? v.trim().toLowerCase() : fallback;
}

function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/* ---------- unknown fields (server rules: docs/anima-essence-frontend.md, design §4.7) ---------- */

/** Matches the server's `calibration_unknown_bytes` limit. */
export const CALIBRATION_UNKNOWN_BYTES = 1024;
export const CALIBRATION_UNKNOWN_KEYS = 16;
export const CALIBRATION_MAX_DEPTH = 3;
export const CALIBRATION_SOURCE_MAX = 32;

const KNOWN_TOP = new Set(["version", "vesselType", "netForm", "shape", "hair", "eyes", "resonance", "silverWarmth", "theme", "source"]);
const KNOWN_NESTED: Record<string, Set<string>> = {
  hair: new Set(["style", "color"]),
  eyes: new Set(["shape", "color"]),
  resonance: new Set(["intensity", "glow"]),
};
export const KNOWN_LEAF_PATHS = [
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
/** Name and tagline live on the Character/Anima row; the server rejects them inside calibration. */
const FORBIDDEN_KEYS = new Set(["name", "tagline", "__proto__", "constructor", "prototype"]);
const UNKNOWN_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;

/** Nesting depth of a JSON value: primitives 0, `{}`/`[]` 1, and so on. */
function jsonDepth(v: unknown): number {
  if (!v || typeof v !== "object") return 0;
  const kids = Array.isArray(v) ? v : Object.values(v as Record<string, unknown>);
  return 1 + kids.reduce<number>((m, k) => Math.max(m, jsonDepth(k)), 0);
}

function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function jsonSafe(v: unknown): unknown {
  try {
    const text = JSON.stringify(v);
    return text === undefined ? undefined : JSON.parse(text);
  } catch {
    return undefined;
  }
}

type UnknownEntry = { path: string; parent: string | null; key: string; value: unknown };

function collectUnknown(r: Record<string, unknown>): UnknownEntry[] {
  const out: UnknownEntry[] = [];
  const consider = (parent: string | null, key: string, raw: unknown) => {
    if (FORBIDDEN_KEYS.has(key) || !UNKNOWN_KEY.test(key)) return;
    const value = jsonSafe(raw);
    if (value === undefined) return;
    // Whole calibration depth ≤ 3: the root is 1, a top-level key's object value 2.
    const allowed = CALIBRATION_MAX_DEPTH - (parent ? 2 : 1);
    if (jsonDepth(value) > allowed) return;
    out.push({ path: parent ? `${parent}.${key}` : key, parent, key, value });
  };
  for (const [k, v] of Object.entries(r)) if (!KNOWN_TOP.has(k)) consider(null, k, v);
  for (const parent of Object.keys(KNOWN_NESTED)) {
    for (const [k, v] of Object.entries(obj(r[parent]))) if (!KNOWN_NESTED[parent].has(k)) consider(parent, k, v);
  }
  return out;
}

function unknownTree(entries: UnknownEntry[]): Record<string, unknown> {
  const tree: Record<string, unknown> = {};
  for (const e of entries) {
    if (!e.parent) tree[e.key] = e.value;
    else tree[e.parent] = { ...obj(tree[e.parent]), [e.key]: e.value };
  }
  return tree;
}

/**
 * Picks which unknown fields survive. Deterministic: candidates are sorted by
 * path (code-unit order), then taken greedily while the serialized unknown
 * fields stay ≤ 1024 UTF-8 bytes and ≤ 16 keys. A field that would overflow is
 * dropped and later, smaller ones may still fit. Same input → same output,
 * whatever the original key order.
 */
export function capUnknownFields(entries: UnknownEntry[]): UnknownEntry[] {
  const sorted = [...entries].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const kept: UnknownEntry[] = [];
  for (const e of sorted) {
    if (kept.length >= CALIBRATION_UNKNOWN_KEYS) break;
    const trial = [...kept, e];
    if (utf8Bytes(JSON.stringify(unknownTree(trial))) <= CALIBRATION_UNKNOWN_BYTES) kept.push(e);
  }
  return kept;
}

/** Serialized size of a calibration's unknown fields, as the server counts them. */
export function unknownFieldBytes(cal: unknown): number {
  return utf8Bytes(JSON.stringify(unknownTree(collectUnknown(obj(cal)))));
}

/**
 * Clamp 0-100, hex colours, enums; keep unknown fields within the server's
 * caps (see capUnknownFields); never carries name/tagline; never throws.
 */
export function normalizeVesselCalibration(raw: unknown): VesselCalibration {
  const r = obj(raw);
  const d = DEFAULT_CALIBRATION;
  const hair = obj(r.hair);
  const eyes = obj(r.eyes);
  const res = obj(r.resonance);
  const kept = capUnknownFields(collectUnknown(r));
  const extras = unknownTree(kept);
  const allowedSource = new Set<string>([...KNOWN_LEAF_PATHS, ...kept.map((e) => e.path)]);
  const source: Record<string, CalibrationSource> = {};
  for (const [k, v] of Object.entries(obj(r.source)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (Object.keys(source).length >= CALIBRATION_SOURCE_MAX) break;
    if (allowedSource.has(k) && (v === "photo" || v === "user" || v === "default")) source[k] = v;
  }
  const out: VesselCalibration = {
    ...extras,
    version: 1,
    vesselType: oneOf(VESSEL_TYPES, r.vesselType, d.vesselType),
    shape: oneOf(VESSEL_SHAPES, r.shape, d.shape),
    hair: { ...obj(extras.hair), style: oneOf(HAIR_STYLES, hair.style, d.hair.style), color: hex(hair.color, d.hair.color) },
    eyes: { ...obj(extras.eyes), shape: oneOf(EYE_SHAPES, eyes.shape, d.eyes.shape), color: hex(eyes.color, d.eyes.color) },
    resonance: {
      ...obj(extras.resonance),
      intensity: clamp100(res.intensity, d.resonance.intensity),
      glow: clamp100(res.glow, d.resonance.glow),
    },
    silverWarmth: clamp100(r.silverWarmth, d.silverWarmth),
    theme: oneOf(THEMES, r.theme, d.theme),
    source,
  };
  const net = oneOf(VESSEL_TYPES, r.netForm, "humanoid");
  if (net !== "humanoid") out.netForm = net as NetForm;
  return out;
}

/* ---------- name / tagline (server: 1–60 chars, no control chars; tagline 0–120) ---------- */

export const NAME_MAX = 60;
export const TAGLINE_MAX = 120;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;

export type IdentityError = "invalid_name" | "invalid_tagline";

/** Same rules the server applies on PUT calibration; trims first. */
export function validateEssenceIdentity(name: string, tagline: string): IdentityError[] {
  const errors: IdentityError[] = [];
  const n = name.trim();
  const t = tagline.trim();
  if (n.length < 1 || n.length > NAME_MAX || CONTROL.test(n)) errors.push("invalid_name");
  if (t.length > TAGLINE_MAX || CONTROL.test(t)) errors.push("invalid_tagline");
  return errors;
}

/**
 * Applies a user edit at `path` (e.g. "hair.color") and marks it 'user'.
 * Fields the photo-to-vessel creator set ('photo') are only replaced by an
 * explicit user edit, never by defaults.
 */
export function setCalibrationField(cal: VesselCalibration, path: string, value: unknown): VesselCalibration {
  const next = JSON.parse(JSON.stringify(cal)) as Record<string, unknown>;
  const parts = path.split(".");
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

/** Silver Tone warmth: 0 = cool platinum, 100 = warm moonlight. */
export function silverToneColor(warmth: number): string {
  const t = Math.min(100, Math.max(0, warmth)) / 100;
  const cool = [0xd9, 0xe2, 0xec];
  const warm = [0xf1, 0xe4, 0xc8];
  return `#${cool.map((c, i) => Math.round(c + (warm[i] - c) * t).toString(16).padStart(2, "0")).join("")}`;
}

/** CSS glow for the 2D preview; strength from Sapphire Resonance. */
export function resonanceGlow(cal: VesselCalibration): string {
  const a = (cal.resonance.intensity / 100) * 0.85;
  const blur = 8 + Math.round((cal.resonance.glow / 100) * 56);
  const alpha = Math.round(a * 255).toString(16).padStart(2, "0");
  return `0 0 ${blur}px ${Math.round(blur / 3)}px #2563eb${alpha}`;
}

/* ---------- on-device store (until Backend Data's route is agreed) ---------- */

export const ESSENCE_STORAGE_KEY = "anima_essence_v1";

export type EssenceProfile = {
  name: string;
  tagline: string;
  calibration: VesselCalibration;
  savedAt: string | null;
};

type Store = Pick<Storage, "getItem" | "setItem">;

function readAll(storage: Store | null | undefined): Record<string, unknown> {
  if (!storage) return {};
  try {
    return obj(JSON.parse(storage.getItem(ESSENCE_STORAGE_KEY) || "{}"));
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, unknown>, storage: Store | null | undefined): boolean {
  if (!storage) return false;
  try {
    storage.setItem(ESSENCE_STORAGE_KEY, JSON.stringify(all));
    return true;
  } catch {
    return false;
  }
}

export function loadEssenceProfile(
  characterId: string,
  fallbackName = "",
  storage: Store | null | undefined = globalThis.localStorage,
): EssenceProfile {
  const row = obj(obj(readAll(storage)[characterId]).profile);
  return {
    name: typeof row.name === "string" && validateEssenceIdentity(row.name, "").length === 0 ? row.name.trim() : fallbackName,
    tagline: typeof row.tagline === "string" && validateEssenceIdentity("x", row.tagline).length === 0 ? row.tagline.trim() : "",
    calibration: normalizeVesselCalibration(row.calibration),
    savedAt: typeof row.savedAt === "string" ? row.savedAt : null,
  };
}

export function saveEssenceProfile(
  characterId: string,
  profile: EssenceProfile,
  storage: Store | null | undefined = globalThis.localStorage,
  now = new Date(),
): EssenceProfile | null {
  if (!characterId) return null;
  if (validateEssenceIdentity(profile.name, profile.tagline).length) return null;
  const all = readAll(storage);
  const saved: EssenceProfile = {
    name: profile.name.trim(),
    tagline: profile.tagline.trim(),
    calibration: normalizeVesselCalibration(profile.calibration),
    savedAt: now.toISOString(),
  };
  all[characterId] = { ...obj(all[characterId]), profile: saved };
  return writeAll(all, storage) ? saved : null;
}

/* ---------- reflections drafts (on device until the server route exists) ---------- */

export type ReflectionDraft = { id: string; text: string; aspect: string | null; created_at: string };

export function loadReflectionDrafts(characterId: string, storage: Store | null | undefined = globalThis.localStorage): ReflectionDraft[] {
  const list = obj(readAll(storage)[characterId]).reflections;
  if (!Array.isArray(list)) return [];
  return list
    .map(obj)
    .filter((r) => typeof r.id === "string" && typeof r.text === "string" && typeof r.created_at === "string")
    .map((r) => ({ id: r.id as string, text: r.text as string, aspect: typeof r.aspect === "string" ? r.aspect : null, created_at: r.created_at as string }));
}

export const REFLECTION_MAX = 2000;

export function addReflectionDraft(
  characterId: string,
  text: string,
  aspect: string | null,
  storage: Store | null | undefined = globalThis.localStorage,
  now = new Date(),
): ReflectionDraft[] | null {
  const clean = text.trim().slice(0, REFLECTION_MAX);
  if (!characterId || !clean) return null;
  const all = readAll(storage);
  const row = obj(all[characterId]);
  const draft: ReflectionDraft = {
    id: `local-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    text: clean,
    aspect,
    created_at: now.toISOString(),
  };
  const list = [draft, ...loadReflectionDrafts(characterId, storage)].slice(0, 200);
  all[characterId] = { ...row, reflections: list };
  return writeAll(all, storage) ? list : null;
}

export function removeReflectionDraft(characterId: string, id: string, storage: Store | null | undefined = globalThis.localStorage): ReflectionDraft[] {
  const all = readAll(storage);
  const list = loadReflectionDrafts(characterId, storage).filter((r) => r.id !== id);
  all[characterId] = { ...obj(all[characterId]), reflections: list };
  writeAll(all, storage);
  return list;
}
