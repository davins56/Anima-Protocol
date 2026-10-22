/**
 * Dream layer, DB + model half. Scheduler: Cloudflare cron "0,15,30,45 * * * *"
 * (worker.ts) or GET /api/notifications/dreams/run with CRON_SECRET.
 *
 * For each companion whose last memory is older than the inactivity window
 * (default 30 min) and who hasn't dreamt since, cluster recent embedded
 * memories, synthesize one abstract, non-literal dream and append it to
 * `dreams`, linked to the current identity core. Nothing is updated or deleted.
 */
import { getPool } from "@workspace/db";
import { createChatCompletionWithFailover } from "../llmFailover";
import { acquireLocalLlmBackground } from "../localLlmSlot";
import { localChatActivityActive } from "../localLlmPriority";
import { logger } from "../logger";
import { currentIdentity } from "../memoryCore/memoryCore";
import {
  clusterMemories,
  dreamConfig,
  dreamSynthesisPrompt,
  extractThemes,
  isNonLiteral,
  parseDreamCompletion,
  parseVector,
  pickDreamCluster,
  templateDream,
  type DreamConfig,
  type DreamMemory,
} from "./dreamCore";

const DREAMABLE_TYPES = ["turn", "emotional_beat", "decision", "milestone", "note", "image_generated", "battle_outcome"];

export type DreamRunSummary = { candidates: number; dreamt: number; skipped: number; failed: number };

function isMissingDreamSchema(err: unknown): boolean {
  const e = err as { code?: string; message?: string };
  return e?.code === "42P01" || /(dreams|dream_surfacings|dream_recent|memory_events).* does not exist/i.test(String(e?.message || ""));
}

export async function findDreamCandidates(cfg: DreamConfig): Promise<{ user_id: string; character_id: string; last_at: string }[]> {
  const { rows } = await getPool().query<{ user_id: string; character_id: string; last_at: string }>(
    `WITH last AS (
       SELECT user_id, character_id, max(occurred_at) AS last_at
       FROM memory_events
       WHERE occurred_at > now() - ($2::float8 * interval '1 hour')
         AND event_type = ANY($5::text[])
       GROUP BY 1, 2
     )
     SELECT l.user_id, l.character_id, l.last_at
     FROM last l
     WHERE l.last_at < now() - ($1::float8 * interval '1 minute')
       AND NOT EXISTS (
         SELECT 1 FROM dreams d
         WHERE d.user_id = l.user_id AND d.character_id = l.character_id
           AND (d.created_at > l.last_at OR d.created_at > now() - ($3::float8 * interval '1 hour'))
       )
     ORDER BY l.last_at DESC
     LIMIT $4`,
    [cfg.inactivityMinutes, cfg.lookbackHours, cfg.cooldownHours, cfg.maxPerRun, DREAMABLE_TYPES],
  );
  return rows;
}

async function loadDreamMemories(userId: string, characterId: string, cfg: DreamConfig): Promise<DreamMemory[]> {
  const { rows } = await getPool().query<{ id: string; content: string; embedding: string; emotional_weight: number; occurred_at: Date | string }>(
    `SELECT e.id, e.content, e.embedding::text AS embedding, e.emotional_weight, e.occurred_at
     FROM memory_events e
     WHERE e.user_id = $1 AND e.character_id = $2
       AND e.occurred_at > now() - ($3::float8 * interval '1 hour')
       AND e.embedding IS NOT NULL
       AND e.event_type = ANY($4::text[])
       AND NOT EXISTS (
         SELECT 1 FROM memory_events r
         WHERE r.event_type = 'retraction' AND r.user_id = e.user_id
           AND r.payload ->> 'target_event_id' = e.id::text)
     ORDER BY e.occurred_at ASC
     LIMIT 160`,
    [userId, characterId, cfg.lookbackHours, DREAMABLE_TYPES],
  );
  return rows
    .map((r) => ({
      id: r.id,
      content: r.content,
      embedding: parseVector(r.embedding) || [],
      emotionalWeight: Number(r.emotional_weight) || 0.5,
      occurredAt: new Date(r.occurred_at).toISOString(),
    }))
    .filter((m) => m.embedding.length);
}

/** Dream once for one companion. Returns the new dream id, or null when skipped. */
export async function dreamFor(userId: string, characterId: string, cfg = dreamConfig()): Promise<string | null> {
  const memories = await loadDreamMemories(userId, characterId, cfg);
  if (memories.length < cfg.minEvents) return null;
  const cluster = pickDreamCluster(clusterMemories(memories, cfg.clusterThreshold));
  if (!cluster) return null;
  const sources = cluster.members.map((m) => m.content);
  const themes = extractThemes(sources);
  const identity = await currentIdentity(userId, characterId).catch(() => null);
  const name = identity?.name || "the companion";
  const traits = Array.isArray(identity?.core_traits) ? identity!.core_traits.map(String) : [];

  let dream: { summary: string; fragment: string; mood: string; themes: string[] } | null = null;
  let synthesizer: "llm" | "template" = "template";
  let model: string | null = null;

  if (!(await localChatActivityActive().catch(() => false))) {
    const grant = await acquireLocalLlmBackground(`dream:${userId}:${characterId}`, { job: "journal" }).catch(() => null);
    if (grant) {
      try {
        const completion = await createChatCompletionWithFailover({
          tier: "light",
          maxTokens: grant.maxTokens(220),
          temperature: 0.95,
          messages: [{ role: "system", content: dreamSynthesisPrompt({ name, traits, themes, memories: sources }) }],
          signal: grant.signal,
          localOnly: true,
        });
        const parsed = parseDreamCompletion(completion.content);
        if (parsed && isNonLiteral(`${parsed.summary} ${parsed.fragment}`, sources)) {
          dream = { ...parsed, themes: parsed.themes.length ? parsed.themes : themes };
          synthesizer = "llm";
          model = (completion as { model?: string }).model || null;
        }
      } catch (err) {
        logger.info({ err: (err as Error)?.message }, "dream: model synthesis unavailable, using template");
      } finally {
        await grant.release();
      }
    }
  }
  if (!dream) dream = { ...templateDream(themes, `${userId}:${characterId}:${cluster.members[0].id}`), themes };

  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO dreams
       (user_id, character_id, identity_core_id, identity_version, source_event_ids, cluster_size, cohesion,
        themes, mood, summary, fragment, window_start, window_end, synthesizer, model)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6,$7,$8::text[],$9,$10,$11,$12,$13,$14,$15)
     RETURNING id`,
    [
      userId,
      characterId,
      identity?.id ?? null,
      identity?.version ?? null,
      cluster.members.map((m) => m.id),
      cluster.members.length,
      cluster.cohesion,
      dream.themes,
      dream.mood,
      dream.summary,
      dream.fragment,
      cluster.members[0].occurredAt,
      cluster.members[cluster.members.length - 1].occurredAt,
      synthesizer,
      model,
    ],
  );
  return rows[0]?.id || null;
}

export async function runDreamCycle(cfg = dreamConfig()): Promise<DreamRunSummary> {
  const summary: DreamRunSummary = { candidates: 0, dreamt: 0, skipped: 0, failed: 0 };
  if (!cfg.enabled) return summary;
  let candidates: Awaited<ReturnType<typeof findDreamCandidates>> = [];
  try {
    candidates = await findDreamCandidates(cfg);
  } catch (err) {
    if (isMissingDreamSchema(err)) return summary;
    throw err;
  }
  summary.candidates = candidates.length;
  for (const c of candidates) {
    try {
      (await dreamFor(c.user_id, c.character_id, cfg)) ? summary.dreamt++ : summary.skipped++;
    } catch (err) {
      summary.failed++;
      logger.warn({ err: (err as Error)?.message }, "dream: cycle failed for companion");
    }
  }
  return summary;
}

/** Newest dream fragment not yet surfaced, for an ambient opener. */
export async function pickDreamFragment(userId: string, characterId: string): Promise<{ id: string; fragment: string } | null> {
  try {
    const { rows } = await getPool().query<{ id: string; fragment: string }>(
      `SELECT id, fragment FROM dream_recent
       WHERE user_id = $1 AND character_id = $2 AND surfaced_count = 0
       ORDER BY created_at DESC LIMIT 1`,
      [userId, characterId],
    );
    return rows[0] || null;
  } catch (err) {
    if (isMissingDreamSchema(err)) return null;
    throw err;
  }
}

export async function recordDreamSurfacing(args: { dreamId: string; userId: string; characterId: string; surface: string; sessionId?: string | null }): Promise<void> {
  await getPool().query(
    `INSERT INTO dream_surfacings (dream_id, user_id, character_id, surface, session_id) VALUES ($1,$2,$3,$4,$5)`,
    [args.dreamId, args.userId, args.characterId, args.surface, args.sessionId ?? null],
  );
}
