/** Web search I/O (supabase/migrations/20261022290000_web_search.sql). */
import { getPool } from "@workspace/db";
import { builtInKeyFor } from "../companions/builtIn";
import { appendMemoryEvent } from "../memoryCore/memoryCore";
import {
  cleanQuery,
  filterQuery,
  filterResults,
  formatSearchContext,
  remainingToday,
  resolveSearchEnabled,
  searchConfig,
  type FilterVerdict,
  type SearchResult,
} from "./searchCore";
import { runProviderSearch } from "./searchProviders";

/** Audited results stay usable as chat context for this long. */
export const SEARCH_CONTEXT_TTL_MIN = 30;

function missing(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === "42P01" || e?.code === "42703";
}

export async function companionSearchEnabled(userId: string, characterId: string, name: unknown): Promise<boolean> {
  let explicit: boolean | null = null;
  try {
    const { rows } = await getPool().query<{ search_enabled: boolean | null }>(
      `SELECT search_enabled FROM character_identity_core
       WHERE user_id = $1 AND character_id = $2 AND search_enabled IS NOT NULL
       ORDER BY version DESC LIMIT 1`,
      [userId, characterId],
    );
    explicit = rows[0]?.search_enabled ?? null;
  } catch (err) {
    if (!missing(err)) throw err;
  }
  return resolveSearchEnabled(explicit, builtInKeyFor(name));
}

/** Searches counted against today's (UTC) free-tier limit: anything that reached the provider. */
export async function searchesUsedToday(userId: string): Promise<number> {
  const { rows } = await getPool().query<{ n: number }>(
    `SELECT count(*)::int AS n FROM search_audit
     WHERE user_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc'
       AND status IN ('ok', 'empty', 'error')`,
    [userId],
  );
  return Number(rows[0]?.n) || 0;
}

async function audit(row: {
  userId: string; characterId: string; query: string; provider: string | null; status: string;
  results?: SearchResult[]; decisions?: FilterVerdict[]; saved?: boolean; latencyMs?: number | null;
}): Promise<string | null> {
  const kept = row.results || [];
  const decisions = row.decisions || [];
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO search_audit
       (user_id, character_id, query, provider, status, results, filter_decisions, result_count, dropped_count, saved_as_memory, latency_ms)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10,$11) RETURNING id`,
    [
      row.userId, row.characterId, row.query, row.provider, row.status,
      JSON.stringify(kept), JSON.stringify(decisions), kept.length,
      decisions.filter((d) => d.verdict === "drop").length, Boolean(row.saved), row.latencyMs ?? null,
    ],
  );
  return rows[0]?.id || null;
}

export type SearchOutcome = {
  status: "ok" | "empty" | "query_blocked" | "rate_limited" | "disabled" | "not_configured" | "error";
  auditId: string | null;
  results: SearchResult[];
  remaining: number;
  reasons?: string[];
};

export async function runCompanionSearch(args: {
  userId: string;
  characterId: string;
  characterName: unknown;
  query: unknown;
  saveAsMemory?: boolean;
}): Promise<SearchOutcome> {
  const cfg = searchConfig();
  const query = cleanQuery(args.query);
  const base = { userId: args.userId, characterId: args.characterId, query: query || "(empty)" };
  if (!(await companionSearchEnabled(args.userId, args.characterId, args.characterName))) {
    return { status: "disabled", auditId: await audit({ ...base, provider: null, status: "disabled" }), results: [], remaining: 0 };
  }
  if (!cfg.provider) {
    return { status: "not_configured", auditId: null, results: [], remaining: 0 };
  }
  // Rate limit is checked before any query leaves the server.
  const used = await searchesUsedToday(args.userId);
  const remaining = remainingToday(used, cfg.dailyLimit);
  if (remaining <= 0) {
    return { status: "rate_limited", auditId: await audit({ ...base, provider: cfg.provider, status: "rate_limited" }), results: [], remaining: 0 };
  }
  const q = filterQuery(query);
  if (!query || !q.ok) {
    return {
      status: "query_blocked",
      auditId: await audit({ ...base, provider: null, status: "query_blocked", decisions: [{ url: "(query)", verdict: "drop", reasons: q.reasons.length ? q.reasons : ["empty"] }] }),
      results: [],
      remaining,
      reasons: q.reasons,
    };
  }
  const started = Date.now();
  let raw: SearchResult[] = [];
  try {
    raw = await runProviderSearch(cfg.provider, query, cfg.maxResults);
  } catch (err) {
    await audit({ ...base, provider: cfg.provider, status: "error", latencyMs: Date.now() - started,
      decisions: [{ url: "(provider)", verdict: "drop", reasons: [String((err as Error)?.message || "error").slice(0, 120)] }] });
    return { status: "error", auditId: null, results: [], remaining: remaining - 1 };
  }
  const { kept, decisions } = filterResults(raw, cfg.maxResults);
  const status = kept.length ? "ok" : "empty";
  const auditId = await audit({ ...base, provider: cfg.provider, status, results: kept, decisions, saved: Boolean(args.saveAsMemory && kept.length), latencyMs: Date.now() - started });
  if (args.saveAsMemory && kept.length && auditId) {
    // Optional: the user asked to keep these. Append-only web_result memories.
    await Promise.all(
      kept.slice(0, 3).map((r, i) =>
        appendMemoryEvent({
          userId: args.userId,
          characterId: args.characterId,
          eventType: "web_result",
          content: `Looked up "${query}": ${r.title} — ${r.snippet}`.slice(0, 600),
          payload: { audit_id: auditId, url: r.url, title: r.title },
          emotionalWeight: 0.3,
          dedupeKey: `web:${auditId}:${i}`,
          source: "web_search",
        }).catch(() => null),
      ),
    );
  }
  return { status, auditId, results: kept, remaining: remaining - 1 };
}

/** Chat turn: rebuild the transient context from the server's own audit row (never from client text). */
export async function searchContextForTurn(userId: string, characterId: string | null, auditId: unknown): Promise<string> {
  const id = String(auditId || "");
  if (!/^[0-9a-f-]{36}$/i.test(id)) return "";
  try {
    const { rows } = await getPool().query<{ query: string; results: SearchResult[]; created_at: Date }>(
      `SELECT query, results, created_at FROM search_audit
       WHERE id = $1 AND user_id = $2 AND status = 'ok'
         AND ($3::text IS NULL OR character_id = $3)
         AND created_at > now() - ($4::int * interval '1 minute')`,
      [id, userId, characterId, SEARCH_CONTEXT_TTL_MIN],
    );
    const r = rows[0];
    return r ? formatSearchContext(r.query, Array.isArray(r.results) ? r.results : [], new Date(r.created_at)) : "";
  } catch (err) {
    if (missing(err)) return "";
    throw err;
  }
}

export async function searchStatus(userId: string, characterId: string, name: unknown) {
  const cfg = searchConfig();
  const enabled = await companionSearchEnabled(userId, characterId, name);
  const used = enabled && cfg.provider ? await searchesUsedToday(userId).catch(() => 0) : 0;
  return {
    enabled: enabled && Boolean(cfg.provider),
    flag: enabled,
    provider_configured: Boolean(cfg.provider),
    daily_limit: cfg.dailyLimit,
    remaining: remainingToday(used, cfg.dailyLimit),
  };
}
