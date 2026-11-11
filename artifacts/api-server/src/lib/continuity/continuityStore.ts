/** Continuity I/O (supabase/migrations/20261022280000_continuity.sql). */
import { getPool } from "@workspace/db";
import { dreamConfig } from "../dreams/dreamCore";
import {
  continuityGreeting,
  echoThemesFrom,
  presenceState,
  type CompanionState,
  type ContinuitySurface,
  type DreamFragment,
  type Highlight,
} from "./continuityCore";

type Row = {
  last_interaction_at: Date | string | null;
  active_band: string | null;
  vessel_version: number | null;
  last_dream_at: Date | string | null;
  recent_dreams: DreamFragment[] | null;
  last_seen_at: Date | string | null;
  unread_highlights: Highlight[] | null;
};

const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

function isMissing(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "42P01" || e?.code === "42703";
}

export function emptyState(characterId: string): CompanionState {
  return {
    characterId, lastInteractionAt: null, emotionalTone: null, activeBand: null, vesselVersion: null,
    lastDreamAt: null, recentDreams: [], lastSeenAt: null, unreadHighlights: [], echoThemes: [],
  };
}

export async function loadCompanionState(userId: string, characterId: string): Promise<CompanionState> {
  const pool = getPool();
  const [main, tone, docs] = await Promise.all([
    pool.query<Row>(`SELECT * FROM companion_state WHERE user_id = $1 AND character_id = $2`, [userId, characterId]).catch((e) => {
      if (isMissing(e)) return { rows: [] as Row[] };
      throw e;
    }),
    pool
      .query<{ mood: string | null }>(
        `SELECT emotional_state -> 'selfState' ->> 'mood' AS mood FROM companion_memories
         WHERE user_id = $1 AND character_id = $2 ORDER BY updated_at DESC LIMIT 1`,
        [userId, characterId],
      )
      .catch(() => ({ rows: [] as { mood: string | null }[] })),
    // Cross-surface echo: recent PDF chunks (document_chunk memories) shared with her.
    pool
      .query<{ content: string }>(
        `SELECT content FROM memory_events
         WHERE user_id = $1 AND character_id = $2 AND event_type = 'document_chunk'
           AND occurred_at > now() - interval '14 days'
         ORDER BY occurred_at DESC LIMIT 24`,
        [userId, characterId],
      )
      .catch(() => ({ rows: [] as { content: string }[] })),
  ]);
  const r = main.rows[0];
  const state = emptyState(characterId);
  state.emotionalTone = tone.rows[0]?.mood || null;
  state.echoThemes = echoThemesFrom(docs.rows.map((d) => d.content));
  if (!r) return state;
  return {
    ...state,
    lastInteractionAt: iso(r.last_interaction_at),
    activeBand: r.active_band,
    vesselVersion: r.vessel_version == null ? null : Number(r.vessel_version),
    lastDreamAt: iso(r.last_dream_at),
    recentDreams: Array.isArray(r.recent_dreams) ? r.recent_dreams : [],
    lastSeenAt: iso(r.last_seen_at),
    unreadHighlights: Array.isArray(r.unread_highlights) ? r.unread_highlights : [],
  };
}

export async function recordStateSnapshot(userId: string, characterId: string, surface: ContinuitySurface, state: CompanionState): Promise<void> {
  await getPool()
    .query(
      `INSERT INTO companion_state_snapshots (user_id, character_id, surface, state) VALUES ($1,$2,$3,$4::jsonb)`,
      [userId, characterId, surface, JSON.stringify({ ...state, recentDreams: state.recentDreams.map((d) => d.id) })],
    )
    .catch((e) => {
      if (!isMissing(e)) throw e;
    });
}

/** Session-start payload for any surface. Appends a snapshot (marks highlights read). */
export async function sessionStart(args: {
  userId: string;
  characterId: string;
  name: string;
  surface: ContinuitySurface;
  tzOffsetMinutes?: number | null;
  now?: number;
}) {
  const state = await loadCompanionState(args.userId, args.characterId);
  const now = args.now ?? Date.now();
  const presence = presenceState({
    lastInteractionAt: state.lastInteractionAt,
    lastDreamAt: state.lastDreamAt,
    inactivityMinutes: dreamConfig().inactivityMinutes,
    now,
  });
  const greeting = args.surface === "chat" ? continuityGreeting({ name: args.name, state, now, tzOffsetMinutes: args.tzOffsetMinutes }) : null;
  await recordStateSnapshot(args.userId, args.characterId, args.surface, state);
  return { state, presence, greeting };
}
