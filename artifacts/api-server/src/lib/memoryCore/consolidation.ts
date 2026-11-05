/**
 * Memory consolidation, DB + model half (switch `memory_consolidation`).
 * Scheduler: the dream-layer Cloudflare cron in worker.ts, or
 * GET /api/notifications/memory/consolidate/run with CRON_SECRET.
 *
 * For each companion with enough old, embedded, unconsolidated episodes:
 * cluster them, ask the local model for a few literal statements, and append
 * one `note` event (payload.kind = "consolidation") that lists its sources.
 * Append-only like the rest of the memory core: nothing is updated or
 * deleted, sources stay recallable, and a retraction still hides them.
 * Memory text only ever goes to the local model (localOnly), never a
 * third-party API. When the model is busy or unavailable, nothing is written.
 */
import { getPool } from "@workspace/db";
import { clusterMemories, parseVector, type DreamMemory } from "../dreams/dreamCore";
import { isKernelFeatureEnabled } from "../kernelFeatures";
import { createChatCompletionWithFailover } from "../llmFailover";
import { localChatActivityActive } from "../localLlmPriority";
import { acquireLocalLlmBackground } from "../localLlmSlot";
import { logger } from "../logger";
import {
  CONSOLIDATABLE_TYPES,
  CONSOLIDATION_KIND,
  CONSOLIDATION_VERSION,
  consolidatedWeight,
  consolidationConfig,
  consolidationDedupeKey,
  consolidationPrompt,
  parseConsolidation,
  pickConsolidationClusters,
  type ConsolidationConfig,
} from "./consolidationCore";
import { appendMemoryEvent, currentIdentity, isMissingMemorySchema } from "./memoryCore";

export type ConsolidationRunSummary = {
  enabled: boolean;
  candidates: number;
  consolidated: number;
  skipped: number;
  failed: number;
};

/** Shared WHERE for "an old, embedded, live, not-yet-consolidated episode". */
const ELIGIBLE = `
  e.event_type = ANY($1::text[])
  AND e.embedding IS NOT NULL
  AND e.occurred_at < now() - ($2::float8 * interval '1 hour')
  AND e.occurred_at > now() - ($3::float8 * interval '1 day')
  AND NOT EXISTS (
    SELECT 1 FROM memory_events r
    WHERE r.event_type = 'retraction' AND r.user_id = e.user_id
      AND r.payload ->> 'target_event_id' = e.id::text)
  AND NOT EXISTS (
    SELECT 1 FROM memory_events c
    WHERE c.user_id = e.user_id AND c.character_id = e.character_id
      AND c.event_type = 'note' AND c.payload ->> 'kind' = '${CONSOLIDATION_KIND}'
      AND c.payload -> 'source_event_ids' @> jsonb_build_array(e.id::text))`;

export async function findConsolidationCandidates(
  cfg: ConsolidationConfig,
): Promise<{ user_id: string; character_id: string; n: number }[]> {
  const { rows } = await getPool().query<{ user_id: string; character_id: string; n: number }>(
    `SELECT e.user_id, e.character_id, count(*)::int AS n
     FROM memory_events e
     WHERE ${ELIGIBLE}
     GROUP BY 1, 2
     HAVING count(*) >= $4
     ORDER BY max(e.occurred_at) DESC
     LIMIT $5`,
    [CONSOLIDATABLE_TYPES, cfg.minAgeHours, cfg.lookbackDays, cfg.minClusterSize, cfg.maxPerRun],
  );
  return rows;
}

async function loadEpisodes(userId: string, characterId: string, cfg: ConsolidationConfig): Promise<DreamMemory[]> {
  const { rows } = await getPool().query<{
    id: string;
    content: string;
    embedding: string;
    emotional_weight: number;
    occurred_at: Date | string;
  }>(
    `SELECT e.id, e.content, e.embedding::text AS embedding, e.emotional_weight, e.occurred_at
     FROM memory_events e
     WHERE ${ELIGIBLE} AND e.user_id = $4 AND e.character_id = $5
     ORDER BY e.occurred_at ASC
     LIMIT 160`,
    [CONSOLIDATABLE_TYPES, cfg.minAgeHours, cfg.lookbackDays, userId, characterId],
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

/** Consolidate the heaviest eligible cluster for one companion. Returns the new note id, or null. */
export async function consolidateFor(
  userId: string,
  characterId: string,
  cfg = consolidationConfig(),
): Promise<string | null> {
  const episodes = await loadEpisodes(userId, characterId, cfg);
  const [cluster] = pickConsolidationClusters(clusterMemories(episodes, cfg.clusterThreshold), cfg.minClusterSize);
  if (!cluster) return null;
  if (await localChatActivityActive().catch(() => false)) return null;

  const identity = await currentIdentity(userId, characterId).catch(() => null);
  const companionName = identity?.name || "the companion";
  const grant = await acquireLocalLlmBackground(`consolidate:${userId}:${characterId}`, { job: "journal" }).catch(
    () => null,
  );
  if (!grant) return null;

  let statements: string[] = [];
  try {
    const completion = await createChatCompletionWithFailover({
      tier: "light",
      maxTokens: grant.maxTokens(220),
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content: consolidationPrompt({
            companionName,
            memories: cluster.members.map((m) => m.content),
            maxStatements: cfg.maxStatements,
          }),
        },
      ],
      signal: grant.signal,
      localOnly: true,
    });
    statements = parseConsolidation(completion.content, companionName, cfg.maxStatements);
  } catch (err) {
    logger.info({ err: (err as Error)?.message }, "consolidation: local model unavailable");
    return null;
  } finally {
    await grant.release();
  }
  if (!statements.length) return null;

  const sourceIds = cluster.members.map((m) => m.id);
  return appendMemoryEvent({
    userId,
    characterId,
    eventType: "note",
    content: statements.join(" "),
    payload: {
      kind: CONSOLIDATION_KIND,
      version: CONSOLIDATION_VERSION,
      statements,
      source_event_ids: sourceIds,
      cluster_size: sourceIds.length,
      cohesion: Math.round(cluster.cohesion * 1000) / 1000,
      window_start: cluster.members[0].occurredAt,
      window_end: cluster.members[cluster.members.length - 1].occurredAt,
    },
    emotionalWeight: consolidatedWeight(cluster),
    identityVersion: identity?.version ?? null,
    dedupeKey: consolidationDedupeKey(sourceIds),
    source: CONSOLIDATION_KIND,
  });
}

export async function runConsolidationCycle(cfg = consolidationConfig()): Promise<ConsolidationRunSummary> {
  const summary: ConsolidationRunSummary = { enabled: false, candidates: 0, consolidated: 0, skipped: 0, failed: 0 };
  if (!isKernelFeatureEnabled("memory_consolidation")) return summary;
  summary.enabled = true;
  let candidates: Awaited<ReturnType<typeof findConsolidationCandidates>> = [];
  try {
    candidates = await findConsolidationCandidates(cfg);
  } catch (err) {
    if (isMissingMemorySchema(err)) return summary;
    throw err;
  }
  summary.candidates = candidates.length;
  for (const c of candidates) {
    try {
      (await consolidateFor(c.user_id, c.character_id, cfg)) ? summary.consolidated++ : summary.skipped++;
    } catch (err) {
      summary.failed++;
      logger.warn({ err: (err as Error)?.message }, "consolidation: failed for companion");
    }
  }
  return summary;
}
