/**
 * Versioned 3D vessel configs (supabase/migrations/20261022170000_character_vessel.sql).
 * Saving goes through save_vessel_version(): new vessel row → new identity core
 * version → `vessel_changed` memory event, atomically.
 *
 * VesselConfig schema 2 adds model metadata (format, expressions, visemes).
 * Schema 1 rows are still accepted and re-emitted as schema 2.
 */
import { getPool } from "@workspace/db";
import { MODEL_BUCKET, safeStorageSegment } from "./modelStorage";

export const VESSEL_SCHEMA_VERSION = 2;
const MAX_CONFIG_BYTES = 8 * 1024;
const MAX_EXPR = 64;
const MAX_EXPR_LEN = 40;

export type VesselRow = {
  id: string;
  character_id: string;
  version: number;
  config: Record<string, unknown>;
  snapshot_bucket: string | null;
  snapshot_path: string | null;
  change_note: string;
  created_at: string;
};

const HEX = /^#[0-9a-f]{6}$/i;
const ENUMS: Record<string, string[]> = {
  base: ["serenity", "linda", "aeland", "scarlet", "custom"],
  bodyType: ["slender", "athletic", "curvy", "petite", "tall"],
  "hair.style": ["long", "bob", "pixie", "braid", "ponytail", "wild", "bun"],
  "effects.aura": ["none", "halo", "wings", "sparks", "mist", "glitch", "flame"],
  "model.kind": ["procedural", "gltf", "vrm"],
  "model.format": ["vrm", "glb"],
};

function str(v: unknown, max = 60): string | undefined {
  return typeof v === "string" ? v.slice(0, max) : undefined;
}
function color(v: unknown): string | undefined {
  return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined;
}
function num(v: unknown, min: number, max: number): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : undefined;
}
/** Aeland's legacy preset keys in already-saved vessel rows (read side only; rows are never rewritten). */
export const LEGACY_VESSEL_BASES: Record<string, string> = { aelindra: "aeland", aelynd: "aeland", aelyndra: "aeland" };

function oneOf(key: string, v: unknown): string | undefined {
  if (key === "base" && typeof v === "string" && LEGACY_VESSEL_BASES[v.toLowerCase()]) return LEGACY_VESSEL_BASES[v.toLowerCase()];
  return typeof v === "string" && ENUMS[key].includes(v) ? v : undefined;
}

const VISEMES = ["aa", "ih", "ou", "ee", "oh"] as const;

export function modelUrlHostAllowlist(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.VESSEL_MODEL_URL_HOSTS || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

const SAME_ORIGIN_MODEL = /^\/api\/vessel\/([^/?#\s]{1,120})\/model$/;

function isSafeCharacterSegment(id: string): boolean {
  try {
    const decoded = decodeURIComponent(id);
    if (!decoded || decoded.length > 120) return false;
    if (decoded.includes("..") || decoded.includes("/") || decoded.includes("\\") || decoded.includes("\u0000")) return false;
    return true;
  } catch {
    return false;
  }
}

/** Same-origin viewer URL stored on the vessel (never an absolute storage URL). */
export function vesselModelPublicUrl(characterId: string): string {
  return `/api/vessel/${encodeURIComponent(characterId)}/model`;
}

export function sanitizeModelUrl(raw: unknown, env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (typeof raw !== "string") return undefined;
  const url = raw.trim().slice(0, 500);
  const same = url.match(SAME_ORIGIN_MODEL);
  if (same && isSafeCharacterSegment(same[1])) return url;
  if (!/^https:\/\//i.test(url)) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:") return undefined;
  const host = parsed.hostname.toLowerCase();
  if (!modelUrlHostAllowlist(env).includes(host)) return undefined;
  if (!/\.(vrm|glb)$/i.test(parsed.pathname)) return undefined;
  if (parsed.username || parsed.password) return undefined;
  return parsed.toString().slice(0, 500);
}

const OWNED_PATH = /^[A-Za-z0-9_-]{1,80}\/[A-Za-z0-9_-]{1,80}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(vrm|glb)$/i;

function sanitizeModelPath(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const path = raw.replace(/^\/+/, "").slice(0, 240);
  if (path.includes("..") || path.includes("//")) return undefined;
  return OWNED_PATH.test(path) ? path : undefined;
}

function nameList(raw: unknown, allowed?: readonly string[]): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const s = item.trim().slice(0, MAX_EXPR_LEN);
    if (!s) continue;
    const key = s.toLowerCase();
    if (allowed && !allowed.includes(key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(allowed ? key : s);
    if (out.length >= MAX_EXPR) break;
  }
  return out;
}

function sanitizeModel(raw: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const m = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const kind = oneOf("model.kind", m.kind) ?? "procedural";
  const url = sanitizeModelUrl(m.url, env);
  const format = oneOf("model.format", m.format);
  const path = sanitizeModelPath(m.path);
  const bucketName = MODEL_BUCKET();
  const bucket = typeof m.bucket === "string" && m.bucket === bucketName ? bucketName : undefined;
  const byteSize = num(m.byteSize, 1, 50 * 1024 * 1024);
  const expressions = nameList(m.expressions);
  const visemes = nameList(m.visemes, VISEMES);
  const animationCount = num(m.animationCount, 0, 256);
  const humanoid = typeof m.humanoid === "boolean" ? m.humanoid : undefined;
  const out: Record<string, unknown> = { kind };
  if (url) out.url = url;
  if (format) out.format = format;
  if (path) out.path = path;
  if (bucket && path) out.bucket = bucket;
  if (byteSize !== undefined) out.byteSize = Math.round(byteSize);
  if (expressions.length) out.expressions = expressions;
  if (visemes.length) out.visemes = visemes;
  if (humanoid !== undefined) out.humanoid = humanoid;
  if (animationCount !== undefined) out.animationCount = Math.round(animationCount);
  return out;
}

/** Whitelist-only sanitizer; mirrors the client zod schema (vesselConfig.ts). */
export function sanitizeVesselConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  const c = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const out = {
    schema: VESSEL_SCHEMA_VERSION,
    base: oneOf("base", c.base) ?? "custom",
    bodyType: oneOf("bodyType", c.bodyType) ?? "slender",
    height: num(c.height, 0.85, 1.15) ?? 1,
    skinTone: color(c.skinTone) ?? "#c99a7a",
    hair: { style: oneOf("hair.style", c.hair?.style) ?? "long", color: color(c.hair?.color) ?? "#d8dde6" },
    eyes: { color: color(c.eyes?.color) ?? "#22d3ee", glow: num(c.eyes?.glow, 0, 1) ?? 0.4 },
    outfit: {
      top: str(c.outfit?.top, 40) ?? "robe",
      bottom: str(c.outfit?.bottom, 40) ?? "skirt",
      color: color(c.outfit?.color) ?? "#f1f5f9",
      accent: color(c.outfit?.accent) ?? "#d4af37",
    },
    accessories: Array.isArray(c.accessories) ? c.accessories.map((a: unknown) => str(a, 30)).filter(Boolean).slice(0, 8) : [],
    effects: {
      aura: oneOf("effects.aura", c.effects?.aura) ?? "none",
      glow: num(c.effects?.glow, 0, 1) ?? 0.3,
      particles: Math.round(num(c.effects?.particles, 0, 400) ?? 60),
      color: color(c.effects?.color) ?? "#00e5ff",
    },
    model: sanitizeModel(c.model, env),
  };
  if (JSON.stringify(out).length > MAX_CONFIG_BYTES) throw Object.assign(new Error("Vessel config too large"), { status: 413 });
  return out;
}

export async function requireOwnedCharacter(userId: string, characterId: string): Promise<{ name: string }> {
  const { rows } = await getPool().query<{ entity_name: string; data: Record<string, unknown> }>(
    `SELECT entity_name, data FROM user_entities
      WHERE user_id = $1 AND entity_id = $2 AND entity_name IN ('Character', 'Anima')
      ORDER BY (entity_name = 'Character') DESC LIMIT 1`,
    [userId, characterId],
  );
  if (!rows[0]) {
    throw Object.assign(new Error("Character not found."), { status: 404, code: "character_not_found" });
  }
  const name = typeof rows[0].data?.name === "string" && rows[0].data.name.trim()
    ? String(rows[0].data.name).trim().slice(0, 120)
    : characterId;
  return { name };
}

export async function currentVessel(userId: string, characterId: string): Promise<VesselRow | null> {
  const { rows } = await getPool().query<VesselRow>(
    `SELECT * FROM character_vessel WHERE user_id = $1 AND character_id = $2 ORDER BY version DESC LIMIT 1`,
    [userId, characterId],
  );
  const row = rows[0] || null;
  if (row?.config) row.config = sanitizeVesselConfig(row.config);
  return row;
}

export async function saveVessel(args: {
  userId: string;
  characterId: string;
  name: string;
  config: unknown;
  changeNote?: string;
  snapshotBucket?: string | null;
  snapshotPath?: string | null;
}): Promise<{ vessel: VesselRow; identity_version: number }> {
  const config = sanitizeVesselConfig(args.config);
  const { rows } = await getPool().query<{ r: { vessel: VesselRow; identity_version: number } }>(
    `SELECT save_vessel_version($1, $2, $3, $4::jsonb, $5, $6, $7) AS r`,
    [
      args.userId,
      args.characterId,
      args.name,
      JSON.stringify(config),
      (args.changeNote || "").slice(0, 200),
      args.snapshotBucket ?? null,
      args.snapshotPath ?? null,
    ],
  );
  return rows[0].r;
}

/** Merge a newly uploaded model into the current (or default) vessel config. */
export function configWithModel(
  current: Record<string, unknown> | null | undefined,
  characterId: string,
  model: Record<string, unknown>,
): Record<string, unknown> {
  const base = current && typeof current === "object" ? current : {};
  return { ...base, model: { ...model, url: vesselModelPublicUrl(characterId) } };
}

// Re-export so callers can build storage keys with the same rules.
export { safeStorageSegment };
