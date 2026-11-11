/**
 * Sensory layer persistence: the latest snapshot only, on
 * `user_profiles.data.senses`. One statement per write so other profile keys
 * (settings, operator_model, …) are never clobbered. No history is kept.
 */
import { getPool } from "@workspace/db";
import { normalizeSensesSnapshot, readStoredSenses, SENSES_PROFILE_KEY, type SensesSnapshot } from "./senses";

export async function saveSenses(userId: string, raw: unknown, now = Date.now()): Promise<SensesSnapshot> {
  const snap = normalizeSensesSnapshot(raw, now);
  await getPool().query(
    `INSERT INTO user_profiles (user_id, data, updated_at)
     VALUES ($1, jsonb_build_object('${SENSES_PROFILE_KEY}', $2::jsonb), now())
     ON CONFLICT (user_id) DO UPDATE
       SET data = COALESCE(user_profiles.data, '{}'::jsonb) || jsonb_build_object('${SENSES_PROFILE_KEY}', $2::jsonb),
           updated_at = now()`,
    [userId, JSON.stringify(snap)],
  );
  return snap;
}

export async function loadSenses(userId: string, now = Date.now()): Promise<SensesSnapshot | null> {
  const { rows } = await getPool().query<{ senses: unknown }>(
    `SELECT data -> '${SENSES_PROFILE_KEY}' AS senses FROM user_profiles WHERE user_id = $1`,
    [userId],
  );
  return readStoredSenses(rows[0]?.senses ?? null, now);
}

export async function clearSenses(userId: string): Promise<void> {
  await getPool().query(
    `UPDATE user_profiles SET data = data - '${SENSES_PROFILE_KEY}', updated_at = now() WHERE user_id = $1`,
    [userId],
  );
}
