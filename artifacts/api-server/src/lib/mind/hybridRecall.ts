/**
 * Hybrid memory ranking + token-budgeted packing for one companion turn.
 *
 * Candidates come from three places: durable user facts (memory_events
 * notes, kind=user_fact), the rolling session summary, and recalled moments
 * (recall_memories over the append-only stream, already vector-scored in
 * Postgres). This module is pure so ranking, dedupe and budget trimming are
 * unit-testable without a database.
 */
import { approxTokens, containment, jaccard, tokenSet } from "./textSim";

export type KnowledgeKind = "fact" | "moment";

export type KnowledgeCandidate = {
  id: string;
  kind: KnowledgeKind;
  text: string;
  /** Cosine similarity from pgvector (0..1), or null when no embedding. */
  similarity?: number | null;
  /** ISO timestamp. */
  occurredAt?: string | null;
  /** 0..1 — emotional weight for moments, importance for facts. */
  importance?: number | null;
};

export type RankedKnowledge = KnowledgeCandidate & { score: number };

export type RankOptions = {
  query: string;
  now?: number;
  /** Texts already visible in the replayed history window. */
  historyTexts?: string[];
  weights?: { similarity: number; recency: number; importance: number };
};

const HALF_LIFE_DAYS: Record<KnowledgeKind, number> = { fact: 180, moment: 30 };
const DEFAULT_WEIGHTS = { similarity: 0.55, recency: 0.2, importance: 0.25 };
/** Two candidates this similar are the same memory. */
export const DUPLICATE_JACCARD = 0.6;
/** A candidate this contained in a visible history message is redundant. */
export const HISTORY_CONTAINMENT = 0.8;

function clamp01(n: unknown, d: number): number {
  const v = typeof n === "number" ? n : Number(n);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : d;
}

export function recencyScore(kind: KnowledgeKind, occurredAt: string | null | undefined, now: number): number {
  const t = occurredAt ? Date.parse(occurredAt) : NaN;
  if (!Number.isFinite(t)) return 0.5;
  const ageDays = Math.max(0, (now - t) / 86_400_000);
  return Math.exp((-Math.LN2 * ageDays) / HALF_LIFE_DAYS[kind]);
}

/**
 * Score = w·similarity + w·recency + w·importance. With no vector score, a
 * keyword overlap with the user's message stands in (scaled down so a lucky
 * keyword never beats a true semantic hit). Facts get a small floor because
 * who the user is matters on every turn, not only when the topic matches.
 */
export function scoreCandidate(c: KnowledgeCandidate, opts: RankOptions): number {
  const now = opts.now ?? Date.now();
  const w = opts.weights ?? DEFAULT_WEIGHTS;
  const sim =
    typeof c.similarity === "number" && Number.isFinite(c.similarity)
      ? clamp01(c.similarity, 0)
      : 0.7 * jaccard(tokenSet(c.text), tokenSet(opts.query)) + 0.15;
  const score =
    w.similarity * sim +
    w.recency * recencyScore(c.kind, c.occurredAt, now) +
    w.importance * clamp01(c.importance, 0.5);
  return c.kind === "fact" ? score + 0.05 : score;
}

/** Rank, drop duplicates and anything already visible in history. */
export function rankKnowledge(candidates: KnowledgeCandidate[], opts: RankOptions): RankedKnowledge[] {
  const history = (opts.historyTexts ?? []).map((t) => tokenSet(t)).filter((s) => s.size > 0);
  const scored = candidates
    .filter((c) => String(c.text || "").trim())
    .map((c) => ({ ...c, score: scoreCandidate(c, opts) }))
    .sort((a, b) => b.score - a.score);
  const kept: RankedKnowledge[] = [];
  const keptTokens: Array<Set<string>> = [];
  for (const c of scored) {
    const tokens = tokenSet(c.text);
    if (keptTokens.some((k) => jaccard(k, tokens) >= DUPLICATE_JACCARD)) continue;
    // A moment already on screen is wasted budget. Facts stay: they are the
    // stable record even when the user just said it.
    if (c.kind === "moment" && history.some((h) => containment(tokens, h) >= HISTORY_CONTAINMENT)) continue;
    kept.push(c);
    keptTokens.push(tokens);
  }
  return kept;
}

export type PackedKnowledge = {
  summary: string;
  facts: RankedKnowledge[];
  moments: RankedKnowledge[];
  tokens: number;
};

/**
 * Pack within `budgetTokens`: the rolling summary first (capped at 40% of
 * the budget), then facts and moments interleaved by score.
 */
export function packKnowledge(
  ranked: RankedKnowledge[],
  summary: string,
  budgetTokens: number,
  caps: { facts?: number; moments?: number } = {},
): PackedKnowledge {
  const maxFacts = caps.facts ?? 24;
  const maxMoments = caps.moments ?? 10;
  let used = 0;
  let summaryText = String(summary || "").trim();
  const summaryCap = Math.floor(budgetTokens * 0.4);
  if (approxTokens(summaryText) > summaryCap) {
    summaryText = `${summaryText.slice(0, Math.max(0, summaryCap * 4 - 1)).trimEnd()}…`;
  }
  if (summaryCap <= 0) summaryText = "";
  used += approxTokens(summaryText);
  const facts: RankedKnowledge[] = [];
  const moments: RankedKnowledge[] = [];
  for (const item of ranked) {
    const cost = approxTokens(item.text) + 4;
    if (used + cost > budgetTokens) continue;
    if (item.kind === "fact") {
      if (facts.length >= maxFacts) continue;
      facts.push(item);
    } else {
      if (moments.length >= maxMoments) continue;
      moments.push(item);
    }
    used += cost;
  }
  return { summary: summaryText, facts, moments, tokens: used };
}

function ago(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "a while ago";
  const days = Math.floor((now - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  return `${(days / 365).toFixed(1)} years ago`;
}

/** Render the packed knowledge as one prompt block. */
export function formatKnowledgeBlock(
  packed: PackedKnowledge,
  opts: { userName?: string; now?: number } = {},
): string {
  const now = opts.now ?? Date.now();
  const who = String(opts.userName || "").trim() || "them";
  const parts: string[] = [];
  if (packed.facts.length) {
    parts.push(
      [`What you know about ${who} (true unless they say otherwise):`, ...packed.facts.map((f) => `- ${f.text.trim()}`)].join("\n"),
    );
  }
  if (packed.summary) {
    parts.push(`Earlier in this conversation (summary):\n${packed.summary}`);
  }
  if (packed.moments.length) {
    parts.push(
      [
        "Moments you remember with them:",
        ...packed.moments.map((m) => `- (${ago(m.occurredAt, now)}) ${m.text.replace(/\s+/g, " ").trim()}`),
      ].join("\n"),
    );
  }
  if (!parts.length) return "";
  return [
    "MEMORY — use naturally when it fits; never recite it as a list, never invent details that are not here.",
    ...parts,
  ].join("\n\n");
}
