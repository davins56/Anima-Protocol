/**
 * Versioned 3D vessel configs (supabase/migrations/20261022170000_character_vessel.sql).
 * Saving goes through save_vessel_version(): new vessel row → new identity core
 * version → `vessel_changed` memory event, atomically.
 */
import { getPool } from "@workspace/db";

export const VESSEL_SCHEMA_VERSION = 1;
const MAX_CONFIG_BYTES = 8 * 1024;

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
  base: ["serenity", "linda", "aelindra", "custom"],
  bodyType: ["slender", "athletic", "curvy", "petite", "tall"],
  "hair.style": ["long", "bob", "pixie", "braid", "ponytail", "wild", "bun"],
  "effects.aura": ["none", "halo", "wings", "sparks", "mist", "glitch"],
  "model.kind": ["procedural", "gltf", "vrm"],
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
function oneOf(key: string, v: unknown): string | undefined {
  return typeof v === "string" && ENUMS[key].includes(v) ? v : undefined;
}

/** Whitelist-only sanitizer; mirrors the client zod schema (vesselConfig.ts). */
export function sanitizeVesselConfig(raw: unknown): Record<string, unknown> {
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
    model: {
      kind: oneOf("model.kind", c.model?.kind) ?? "procedural",
      url: typeof c.model?.url === "string" && /^(https:\/\/|\/)/.test(c.model.url) ? c.model.url.slice(0, 500) : undefined,
    },
  };
  if (JSON.stringify(out).length > MAX_CONFIG_BYTES) throw Object.assign(new Error("Vessel config too large"), { status: 413 });
  return out;
}

export async function currentVessel(userId: string, characterId: string): Promise<VesselRow | null> {
  const { rows } = await getPool().query<VesselRow>(
    `SELECT * FROM character_vessel WHERE user_id = $1 AND character_id = $2 ORDER BY version DESC LIMIT 1`,
    [userId, characterId],
  );
  return rows[0] || null;
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
