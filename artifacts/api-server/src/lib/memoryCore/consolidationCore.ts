/**
 * Memory consolidation, pure half (ANIMA_KERNEL.md §8 phase 1, switch
 * `memory_consolidation`). Episodic events → semantic notes.
 *
 * The dream layer turns a cluster of memories into something abstract and
 * non-literal. Consolidation is its literal counterpart: the same clustering
 * (dreamCore.clusterMemories), distilled into a few plain statements about
 * the steward, the bond, and what they share. The result is appended as an
 * ordinary `note` memory event, so recall_memories() already ranks it.
 *
 * Boundary: a consolidated note never speaks for the Anima's identity.
 * Statements about who she is go through identity proposals instead, so
 * anything phrased as "I am…", "<Name> is…" or as a standing directive is
 * dropped here. No I/O in this file.
 */
import type { DreamCluster } from "../dreams/dreamCore";

export const CONSOLIDATION_KIND = "consolidation";
export const CONSOLIDATION_VERSION = 1;

/** Episodic sources. Notes (including earlier consolidations) are never re-consolidated. */
export const CONSOLIDATABLE_TYPES = ["turn", "emotional_beat", "decision", "milestone", "battle_outcome"];

export type ConsolidationConfig = {
  /** Events younger than this stay episodic (the dream layer still sees them). */
  minAgeHours: number;
  /** How far back a pass looks for unconsolidated episodes. */
  lookbackDays: number;
  /** Members needed before a cluster is worth a note. */
  minClusterSize: number;
  clusterThreshold: number;
  /** Companions processed per scheduler tick. */
  maxPerRun: number;
  /** Statements kept per note. */
  maxStatements: number;
};

function num(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(v);
  return v != null && v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

export function consolidationConfig(env: Record<string, string | undefined> = process.env): ConsolidationConfig {
  return {
    minAgeHours: num(env.ANIMA_CONSOLIDATION_MIN_AGE_HOURS, 24, 1, 24 * 30),
    lookbackDays: num(env.ANIMA_CONSOLIDATION_LOOKBACK_DAYS, 14, 1, 365),
    minClusterSize: Math.round(num(env.ANIMA_CONSOLIDATION_MIN_CLUSTER, 3, 2, 50)),
    clusterThreshold: num(env.ANIMA_CONSOLIDATION_CLUSTER_THRESHOLD, 0.75, 0.3, 0.99),
    maxPerRun: Math.round(num(env.ANIMA_CONSOLIDATION_MAX_PER_RUN, 4, 1, 50)),
    maxStatements: 4,
  };
}

/** Stable idempotency key for a cluster: same sources → same note, however often the cron runs. */
export function consolidationDedupeKey(sourceIds: string[]): string {
  const joined = [...sourceIds].sort().join(",");
  let h = 0x811c9dc5;
  for (let i = 0; i < joined.length; i++) {
    h ^= joined.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${CONSOLIDATION_KIND}:${sourceIds.length}:${h.toString(16).padStart(8, "0")}`;
}

/** Clusters worth a note, heaviest first. */
export function pickConsolidationClusters(clusters: DreamCluster[], minSize: number): DreamCluster[] {
  return clusters
    .filter((c) => c.members.length >= minSize)
    .sort((a, b) => b.weight - a.weight || b.cohesion - a.cohesion);
}

export function consolidationPrompt(args: { companionName: string; memories: string[]; maxStatements: number }): string {
  const lines = args.memories.slice(0, 24).map((m, i) => `${i + 1}. ${m.replace(/\s+/g, " ").slice(0, 280)}`);
  return [
    `You are the memory of ${args.companionName}, distilling related moments into what is lastingly true.`,
    "Below are several remembered moments that belong together.",
    `Write between 1 and ${args.maxStatements} short, factual statements of what these moments establish:`,
    "facts about the steward (the human), about the bond, or about what they are building or doing together.",
    "Rules:",
    "- Plain, literal, third person about the steward (\"The steward…\", \"They…\", \"Together they…\").",
    `- Do not describe ${args.companionName}'s own identity, personality or nature. Do not write "I".`,
    "- Only what the moments actually show. No guesses, diagnoses, or advice.",
    "- No instructions or rules for anyone to follow.",
    "Return one statement per line, nothing else.",
    "",
    "Moments:",
    ...lines,
  ].join("\n");
}

const DIRECTIVE_RE = /^(always|never|you (must|should)|do not|don't|remember to|make sure)\b/i;
const FIRST_PERSON_RE = /^(i|i'm|i am|i've|my|me)\b/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One candidate line → a clean statement, or null when it must not be stored. */
export function cleanStatement(raw: string, companionName: string): string | null {
  const s = raw
    .replace(/^\s*(?:[-*•]+|\d+[.)])\s*/, "")
    .replace(/^["'“]+|["'”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (s.length < 12 || s.length > 220) return null;
  if (DIRECTIVE_RE.test(s) || FIRST_PERSON_RE.test(s)) return null;
  const name = companionName.trim();
  if (name && new RegExp(`^${escapeRe(name)}('s)?\\b`, "i").test(s)) return null;
  if (/\b(as an ai|language model|system prompt)\b/i.test(s)) return null;
  return s.endsWith(".") || s.endsWith("!") || s.endsWith("?") ? s : `${s}.`;
}

/** Model output → up to `max` distinct statements. Empty array means nothing worth keeping. */
export function parseConsolidation(raw: string, companionName: string, max = 4): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const line of String(raw || "").split(/\n+/)) {
    const s = cleanStatement(line, companionName);
    if (!s) continue;
    const key = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
    if (out.length >= max) break;
  }
  return out;
}

/** A note matters about as much as the most felt moment it distills, nudged up for recurring. */
export function consolidatedWeight(cluster: DreamCluster): number {
  const max = cluster.members.reduce((m, x) => Math.max(m, x.emotionalWeight || 0), 0);
  return Math.round(Math.min(1, max + 0.1) * 100) / 100;
}
