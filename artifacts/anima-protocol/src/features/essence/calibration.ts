/**
 * Essence wrapper around 3D Visual's canonical vesselCalibration v1 module
 * (src/lib/vessel/vesselCalibration.ts). Types, enums, labelled options,
 * defaults, the normalizer (with the server's unknown-field and source rules),
 * setCalibrationField and CONTROLS_BY_FORM all come from there.
 *
 * Kept here: the name/tagline rules (they live on the character's entry, not
 * in calibration), resetCalibrationField (client side of `reset_paths`), and
 * the on-device store. No server route is wired yet, so settings stay on this
 * device per character, and the UI says so.
 */
import {
  DEFAULT_CALIBRATION,
  normalizeVesselCalibration,
  type CalibrationPath,
  type VesselCalibration,
} from "@/lib/vessel/vesselCalibration";

export {
  CALIBRATION_MAX_DEPTH,
  CALIBRATION_PATHS,
  CALIBRATION_SOURCE_MAX,
  CALIBRATION_UNKNOWN_BYTES,
  CALIBRATION_UNKNOWN_KEYS,
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
  normalizeVesselCalibration,
  setCalibrationField,
  silverToneColor,
  sourceOf,
  unknownFieldBytes,
  utf8ByteLength,
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
