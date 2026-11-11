/**
 * Steward corrections, runtime half. Reads thumbs-down corrections for one
 * companion from reply_ratings_latest and builds the prompt context for a
 * chat turn. Kill switch: ANIMA_STEWARD_CORRECTIONS=off (default on).
 */
import { getPool } from "@workspace/db";
import {
  currentCorrectionBlock,
  formatCorrectionsBlock,
  parseCurrentCorrection,
  selectCorrections,
  toCorrection,
  type Correction,
} from "./correctionsCore";

const LOAD_LIMIT = 60;

export function correctionsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = String(env.ANIMA_STEWARD_CORRECTIONS || "on").trim().toLowerCase();
  return !(raw === "0" || raw === "off" || raw === "false" || raw === "no");
}

function isMissing(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "42703" || e?.code === "42P01";
}

/** Newest first. Works before the note migration (notes then read as null). */
export async function loadCorrections(userId: string, characterId: string): Promise<Correction[]> {
  const params = [userId, characterId, LOAD_LIMIT];
  let rows: Record<string, unknown>[];
  try {
    ({ rows } = await getPool().query(
      `SELECT reply, better_reply, note, context, created_at
         FROM reply_ratings_latest
        WHERE user_id = $1 AND character_id = $2 AND rating = -1
          AND (better_reply IS NOT NULL OR note IS NOT NULL)
        ORDER BY created_at DESC
        LIMIT $3`,
      params,
    ));
  } catch (err) {
    if (!isMissing(err)) throw err;
    try {
      ({ rows } = await getPool().query(
        `SELECT reply, better_reply, context, created_at
           FROM reply_ratings_latest
          WHERE user_id = $1 AND character_id = $2 AND rating = -1 AND better_reply IS NOT NULL
          ORDER BY created_at DESC
          LIMIT $3`,
        params,
      ));
    } catch (inner) {
      if (isMissing(inner)) return [];
      throw inner;
    }
  }
  return rows.map(toCorrection).filter((c): c is Correction => c != null);
}

/**
 * Prompt text for this turn: the re-render instruction (when the client sent
 * a fresh correction with a retry) and the relevant past lessons.
 */
export async function buildCorrectionsContext(args: {
  userId: string;
  characterId: string;
  query: string;
  current?: unknown;
}): Promise<string> {
  if (!correctionsEnabled()) return "";
  const current = parseCurrentCorrection(args.current);
  const loaded = await loadCorrections(args.userId, args.characterId);
  // The reply being re-rendered is already covered by the instruction above.
  const past = current ? loaded.filter((c) => c.reply !== current.original) : loaded;
  const lessons = formatCorrectionsBlock(selectCorrections(past, args.query));
  return [current ? currentCorrectionBlock(current) : "", lessons].filter(Boolean).join("\n\n");
}
