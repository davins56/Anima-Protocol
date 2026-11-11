import { getPool } from "@workspace/db";

/**
 * Owner check: the character must be the signed-in user's Character or Anima row.
 *
 * Same predicate as characterOwnedBy in
 * artifacts/api-server/src/lib/memoryCore/recallLedger.ts:106-116 on
 * origin/feature/recall-ledger (that file is not on main). The unexported
 * userOwnsCompanion in artifacts/api-server/src/lib/pdf/store.ts:122-131
 * uses the same user_entities SQL but is not exported and lives in the PDF
 * store, so this is a small local equivalent rather than a reuse.
 */
export async function characterOwnedBy(userId: string, characterId: string): Promise<boolean> {
  if (!userId || !characterId) return false;
  const { rows } = await getPool().query(
    `SELECT 1 FROM user_entities
      WHERE user_id = $1 AND entity_name IN ('Character', 'Anima') AND entity_id = $2
      LIMIT 1`,
    [userId, characterId],
  );
  return rows.length > 0;
}
