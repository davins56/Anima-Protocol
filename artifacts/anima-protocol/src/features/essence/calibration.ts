/**
 * Essence wrapper around 3D Visual's canonical vesselCalibration v1 module
 * (src/lib/vessel/vesselCalibration.ts). Types, enums, labelled options,
 * defaults, precedence and CONTROLS_BY_FORM come from there.
 *
 * Kept here because the canonical read normalizer is looser than the server's
 * write rules (design §4.7): this wrapper re-applies the deterministic unknown-
 * field cap (≤ 1024 UTF-8 bytes of serialized JSON, ≤ 16 keys, sorted by path),
 * restricts `source` keys to known and kept paths, and adds the name/tagline
 * rules. Known fields are normalized by the canonical module.
 *
 * Storage: no server route is wired yet, so settings stay on this device per
 * character, and the UI says so.
 */
import {
  CALIBRATION_PATHS,
  DEFAULT_CALIBRATION,
  normalizeVesselCalibration as canonicalNormalize,
  type CalibrationPath,
  type CalibrationSource,
  type VesselCalibration,
} from "@/lib/vessel/vesselCalibration";

export {
  CALIBRATION_PATHS,
  CONTROLS_BY_FORM,
  DEFAULT_CALIBRATION,
  EYE_SHAPES,
  EYE_SHAPE_OPTIONS,
  HAIR_STYLES,
  HAIR_STYLE_OPTIONS,
  NET_FORMS,
  NET_FORM_OPTIONS,
  SHAPE_OPTIONS,
  THEMES,
  THEME_OPTIONS,
  VESSEL_SHAPES,
  VESSEL_TYPES,
  VESSEL_TYPE_OPTIONS,
  controlApplies,
  isUserSet,
  labelOf,
  silverToneColor,
  sourceOf,
} from "@/lib/vessel/vesselCalibration";
export type {
  CalibrationControl,
  CalibrationPath,
  CalibrationSource,
  NetForm,
  Option,
  VesselCalibration,
  VesselType,
} from "@/lib/vessel/vesselCalibration";

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
export const KNOWN_LEAF_PATHS = CALIBRATION_PATHS;
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
  const hair = obj(r.hair);
  const eyes = obj(r.eyes);
  const res = obj(r.resonance);
  // Known fields only go through the canonical normalizer; unknowns are added
  // back below under the server's caps, so its looser budget never applies.
  const base = canonicalNormalize({
    version: r.version,
    vesselType: r.vesselType,
    netForm: r.netForm,
    shape: r.shape,
    hair: { style: hair.style, color: hair.color },
    eyes: { shape: eyes.shape, color: eyes.color },
    resonance: { intensity: res.intensity, glow: res.glow },
    silverWarmth: r.silverWarmth,
    theme: r.theme,
  });
  const kept = capUnknownFields(collectUnknown(r));
  const extras = unknownTree(kept);
  const allowedSource = new Set<string>([...KNOWN_LEAF_PATHS, ...kept.map((e) => e.path)]);
  const source: Record<string, CalibrationSource> = {};
  for (const [k, v] of Object.entries(obj(r.source)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (Object.keys(source).length >= CALIBRATION_SOURCE_MAX) break;
    if (allowedSource.has(k) && (v === "photo" || v === "user" || v === "default")) source[k] = v;
  }
  return {
    ...extras,
    ...base,
    hair: { ...obj(extras.hair), ...base.hair },
    eyes: { ...obj(extras.eyes), ...base.eyes },
    resonance: { ...obj(extras.resonance), ...base.resonance },
    source,
  };
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

/**
 * Drops a user/photo value back to "from her vessel": the value returns to the
 * calibration default and its source entry is removed, so precedence lets her
 * existing vessel drive that field again (the client side of `reset_paths`).
 */
export function resetCalibrationField(cal: VesselCalibration, path: CalibrationPath): VesselCalibration {
  const next = JSON.parse(JSON.stringify(cal)) as Record<string, unknown>;
  const parts = path.split(".");
  let cur = next;
  let def: unknown = JSON.parse(JSON.stringify(DEFAULT_CALIBRATION));
  for (const p of parts.slice(0, -1)) {
    cur[p] = obj(cur[p]);
    cur = cur[p] as Record<string, unknown>;
    def = obj(def)[p];
  }
  const leaf = parts[parts.length - 1];
  const value = obj(def)[leaf];
  if (value === undefined) delete cur[leaf];
  else cur[leaf] = value;
  const source = { ...obj(next.source) };
  delete source[path];
  next.source = source;
  return normalizeVesselCalibration(next);
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
