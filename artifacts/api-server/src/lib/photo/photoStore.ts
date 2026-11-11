/**
 * Postgres access for the photo generator (raw SQL through getPool(), the same
 * path imageUploads uses so it works on Hyperdrive/postgres.js and node-pg).
 * Tables: supabase/migrations/20261022150000_photo_generator.sql
 */
import { getPool } from "@workspace/db";
import type { ProviderConfig } from "./providerRouter";
import type { Refinement, SceneSpec, VisualDescriptor } from "./promptComposer";

export type ReferenceImage = {
  url: string;
  storage_bucket?: string | null;
  storage_path?: string;
  kind?: "face" | "half" | "full";
  is_primary?: boolean;
  added_at?: string;
};

export type VisualIdentity = {
  id: string;
  user_id: string;
  character_id: string;
  character_name: string;
  version: number;
  locked: boolean;
  reference_images: ReferenceImage[];
  descriptor: VisualDescriptor;
  negative_traits: string;
  provider_config: ProviderConfig;
  updated_at: string;
};

export type GeneratedImageRow = {
  id: string;
  user_id: string;
  character_id: string;
  identity_id: string | null;
  identity_version: number;
  session_id: string | null;
  message_id: string | null;
  parent_image_id: string | null;
  refinement: Refinement;
  user_prompt: string;
  scene: SceneSpec;
  composed_prompt: string;
  provider: string;
  model: string;
  seed: number | null;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
  width: number | null;
  height: number | null;
  error: string | null;
  created_at: string;
  completed_at: string | null;
};

export function isMissingPhotoSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "42P01" || /relation .*(generated_images|character_visual_identity).* does not exist/i.test(String(e?.message || ""));
}

export async function getIdentity(userId: string, characterId: string): Promise<VisualIdentity | null> {
  const { rows } = await getPool().query<VisualIdentity>(
    `SELECT * FROM character_visual_identity WHERE user_id = $1 AND character_id = $2 LIMIT 1`,
    [userId, characterId],
  );
  return rows[0] || null;
}

export async function upsertIdentity(
  userId: string,
  characterId: string,
  patch: Partial<Pick<VisualIdentity, "character_name" | "locked" | "reference_images" | "descriptor" | "negative_traits" | "provider_config">>,
): Promise<VisualIdentity> {
  const existing = await getIdentity(userId, characterId);
  if (existing?.locked && patch.locked !== false && (patch.reference_images || patch.descriptor)) {
    throw Object.assign(new Error("This visual identity is locked. Unlock it before changing references."), {
      status: 409,
      code: "identity_locked",
    });
  }
  const refsChanged = Boolean(patch.reference_images || patch.descriptor);
  const { rows } = await getPool().query<VisualIdentity>(
    `INSERT INTO character_visual_identity
       (user_id, character_id, character_name, locked, reference_images, descriptor, negative_traits, provider_config)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8::jsonb)
     ON CONFLICT (user_id, character_id) DO UPDATE SET
       character_name   = COALESCE(NULLIF(EXCLUDED.character_name, ''), character_visual_identity.character_name),
       locked           = EXCLUDED.locked,
       reference_images = EXCLUDED.reference_images,
       descriptor       = EXCLUDED.descriptor,
       negative_traits  = EXCLUDED.negative_traits,
       provider_config  = EXCLUDED.provider_config,
       version          = character_visual_identity.version + $9,
       updated_at       = now()
     RETURNING *`,
    [
      userId,
      characterId,
      patch.character_name ?? existing?.character_name ?? "",
      patch.locked ?? existing?.locked ?? false,
      JSON.stringify(patch.reference_images ?? existing?.reference_images ?? []),
      JSON.stringify(patch.descriptor ?? existing?.descriptor ?? {}),
      patch.negative_traits ?? existing?.negative_traits ?? "",
      JSON.stringify(patch.provider_config ?? existing?.provider_config ?? {}),
      existing && refsChanged ? 1 : 0,
    ],
  );
  return rows[0];
}

export async function insertGeneration(row: {
  userId: string;
  characterId: string;
  identity: VisualIdentity | null;
  sessionId?: string | null;
  messageId?: string | null;
  parentImageId?: string | null;
  refinement: Refinement;
  userPrompt: string;
  scene: SceneSpec;
  composedPrompt: string;
  provider: string;
  model: string;
  seed?: number | null;
}): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO generated_images
       (user_id, character_id, identity_id, identity_version, session_id, message_id, parent_image_id,
        refinement, user_prompt, scene, composed_prompt, provider, model, seed, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb,$11,$12,$13,$14,'queued')
     RETURNING id`,
    [
      row.userId,
      row.characterId,
      row.identity?.id ?? null,
      row.identity?.version ?? 1,
      row.sessionId ?? null,
      row.messageId ?? null,
      row.parentImageId ?? null,
      JSON.stringify(row.refinement),
      row.userPrompt,
      JSON.stringify(row.scene),
      row.composedPrompt,
      row.provider,
      row.model,
      row.seed ?? null,
    ],
  );
  return rows[0].id;
}

export async function updateGeneration(
  id: string,
  patch: Partial<{
    status: string;
    provider_request_id: string;
    storage_bucket: string | null;
    storage_path: string;
    width: number;
    height: number;
    content_type: string;
    byte_size: number;
    seed: number;
    error: string;
    message_id: string;
  }>,
): Promise<void> {
  const keys = Object.keys(patch) as Array<keyof typeof patch>;
  if (!keys.length) return;
  const sets = keys.map((k, i) => `"${k}" = $${i + 2}`);
  if (patch.status === "completed" || patch.status === "failed") sets.push(`completed_at = now()`);
  await getPool().query(`UPDATE generated_images SET ${sets.join(", ")} WHERE id = $1`, [id, ...keys.map((k) => patch[k])]);
}

export async function getGeneration(userId: string | null, id: string): Promise<GeneratedImageRow | null> {
  const { rows } = await getPool().query<GeneratedImageRow>(
    userId
      ? `SELECT * FROM generated_images WHERE id = $1 AND user_id = $2 LIMIT 1`
      : `SELECT * FROM generated_images WHERE id = $1 LIMIT 1`,
    userId ? [id, userId] : [id],
  );
  return rows[0] || null;
}

export async function listGenerations(
  userId: string,
  filter: { characterId?: string; sessionId?: string; limit?: number },
): Promise<GeneratedImageRow[]> {
  const where = [`user_id = $1`, `status = 'completed'`];
  const values: unknown[] = [userId];
  if (filter.characterId) {
    values.push(filter.characterId);
    where.push(`character_id = $${values.length}`);
  }
  if (filter.sessionId) {
    values.push(filter.sessionId);
    where.push(`session_id = $${values.length}`);
  }
  values.push(Math.min(Math.max(filter.limit || 24, 1), 100));
  const { rows } = await getPool().query<GeneratedImageRow>(
    `SELECT * FROM generated_images WHERE ${where.join(" AND ")} ORDER BY created_at DESC LIMIT $${values.length}`,
    values,
  );
  return rows;
}
