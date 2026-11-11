/** Versioned character voices (supabase/migrations/20261022190000_character_voice.sql). */
import { getPool } from "@workspace/db";

export type VoiceRow = {
  id: string;
  character_id: string;
  version: number;
  provider: "xai";
  voice_id: string;
  voice_kind: "builtin" | "custom";
  display_name: string | null;
  language: string | null;
  settings: { speed?: number; reasoning_effort?: "high" | "none"; replace?: Record<string, string> };
  created_at: string;
};

export const DEFAULT_VOICE_ID = "eve";

export function sanitizeVoiceSettings(raw: unknown): VoiceRow["settings"] {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, any>;
  const out: VoiceRow["settings"] = {};
  if (typeof r.speed === "number" && Number.isFinite(r.speed)) out.speed = Math.min(1.5, Math.max(0.7, r.speed));
  if (r.reasoning_effort === "high" || r.reasoning_effort === "none") out.reasoning_effort = r.reasoning_effort;
  if (r.replace && typeof r.replace === "object") {
    const entries = Object.entries(r.replace as Record<string, unknown>)
      .filter(([k, v]) => typeof v === "string" && /^[\p{L}\p{N}' ]{1,100}$/u.test(k))
      .slice(0, 50)
      .map(([k, v]) => [k, String(v).slice(0, 128)]);
    if (entries.length) out.replace = Object.fromEntries(entries);
  }
  return out;
}

export async function currentVoice(userId: string, characterId: string): Promise<VoiceRow | null> {
  const { rows } = await getPool().query<VoiceRow>(
    `SELECT id, character_id, version, provider, voice_id, voice_kind, display_name, language, settings, created_at
       FROM character_voice WHERE user_id = $1 AND character_id = $2 ORDER BY version DESC LIMIT 1`,
    [userId, characterId],
  );
  return rows[0] || null;
}

export async function saveVoice(args: {
  userId: string;
  characterId: string;
  name: string;
  voiceId: string;
  kind: "builtin" | "custom";
  displayName?: string | null;
  language?: string | null;
  settings?: unknown;
  cloneSource?: "api" | "console" | null;
  referenceSeconds?: number | null;
  consent?: boolean;
  changeNote?: string;
}): Promise<{ voice: VoiceRow; identity_version: number }> {
  const { rows } = await getPool().query<{ r: { voice: VoiceRow; identity_version: number } }>(
    `SELECT save_voice_version($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12) AS r`,
    [
      args.userId,
      args.characterId,
      args.name,
      args.voiceId,
      args.kind,
      args.displayName ?? null,
      args.language ?? null,
      JSON.stringify(sanitizeVoiceSettings(args.settings)),
      args.cloneSource ?? null,
      args.referenceSeconds ?? null,
      Boolean(args.consent),
      (args.changeNote || "").slice(0, 200),
    ],
  );
  return rows[0].r;
}

export async function loadCharacterRecord(userId: string, characterId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await getPool().query<{ entity_name: string; data: Record<string, unknown> }>(
    `SELECT entity_name, data FROM user_entities
      WHERE user_id = $1 AND entity_id = $2 AND entity_name IN ('Character', 'Anima')
      ORDER BY (entity_name = 'Character') DESC LIMIT 1`,
    [userId, characterId],
  );
  if (!rows[0]) return null;
  return { ...rows[0].data, id: characterId, _isAnima: rows[0].entity_name === "Anima" };
}
