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

/** Clamp 0-100, hex colours, enums; keep unknown fields; never throws. */
export function normalizeVesselCalibration(raw: unknown): VesselCalibration {
  const r = obj(raw);
  const d = DEFAULT_CALIBRATION;
  const hair = obj(r.hair);
  const eyes = obj(r.eyes);
  const res = obj(r.resonance);
  const source: Record<string, CalibrationSource> = {};
  for (const [k, v] of Object.entries(obj(r.source))) {
    if (v === "photo" || v === "user" || v === "default") source[k] = v;
  }
  const out: VesselCalibration = {
    ...r,
    version: 1,
    vesselType: oneOf(VESSEL_TYPES, r.vesselType, d.vesselType),
    shape: oneOf(VESSEL_SHAPES, r.shape, d.shape),
    hair: { style: oneOf(HAIR_STYLES, hair.style, d.hair.style), color: hex(hair.color, d.hair.color) },
    eyes: { shape: oneOf(EYE_SHAPES, eyes.shape, d.eyes.shape), color: hex(eyes.color, d.eyes.color) },
    resonance: { intensity: clamp100(res.intensity, d.resonance.intensity), glow: clamp100(res.glow, d.resonance.glow) },
    silverWarmth: clamp100(r.silverWarmth, d.silverWarmth),
    theme: oneOf(THEMES, r.theme, d.theme),
    source,
  };
  const net = oneOf(VESSEL_TYPES, r.netForm, "humanoid");
  if (net !== "humanoid") out.netForm = net as NetForm;
  else delete out.netForm;
  return out;
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
    name: typeof row.name === "string" ? row.name.slice(0, 60) : fallbackName,
    tagline: typeof row.tagline === "string" ? row.tagline.slice(0, 120) : "",
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
  const all = readAll(storage);
  const saved: EssenceProfile = {
    name: profile.name.trim().slice(0, 60),
    tagline: profile.tagline.trim().slice(0, 120),
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
