/**
 * Data-quality pipeline for fine-tune export: normalize turns, drop
 * error/fallback junk, dedupe near-identical examples, and split a
 * deterministic held-out set.
 *
 * Runs on both curated seed examples and raw DB transcripts so a bad
 * generation (empty reply, provider error text) never trains the model to
 * reproduce it.
 */

import type { ChatTurn, TrainingExample } from "./types";

/**
 * Known error/fallback strings that can end up stored as assistant content
 * (see artifacts/api-server/src/routes/chat.ts) plus generic refusal/apology
 * boilerplate that is never a desirable SFT target.
 */
const ASSISTANT_DENYLIST_PATTERNS: RegExp[] = [
  /companion returned an empty reply/i,
  /^\s*(error|failed to generate|internal error)\b/i,
  /quota exhausted/i,
  /rate limit(ed)?/i,
  /^\s*i'?m sorry,? (but )?i (can'?t|cannot|am unable to)/i,
  /^\s*as an ai( language model)?\b/i,
  /^\s*i'?m (just )?an ai\b/i,
];

export interface CleanOptions {
  /** Minimum non-whitespace length for an assistant turn (default 4). */
  minAssistantChars?: number;
}

/**
 * Trim whitespace, drop empty turns, and merge consecutive turns of the same
 * role (e.g. two user messages sent back-to-back before a reply) so the
 * conversation strictly alternates — required by most chat templates.
 */
export function normalizeTurns(turns: ChatTurn[]): ChatTurn[] {
  const merged: ChatTurn[] = [];
  for (const turn of turns) {
    const content = turn.content?.trim() ?? "";
    if (!content) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n\n${content}`;
      continue;
    }
    merged.push({ ...turn, content });
  }
  return merged;
}

/** True if any assistant turn matches a known error/fallback/refusal pattern. */
export function hasDenylistedAssistantContent(turns: ChatTurn[]): boolean {
  return turns.some(
    (t) =>
      t.role === "assistant" &&
      ASSISTANT_DENYLIST_PATTERNS.some((re) => re.test(t.content)),
  );
}

export interface QualityCheck {
  ok: boolean;
  reason?: string;
}

/** Quality gate for a single training example. */
export function checkExampleQuality(
  example: TrainingExample,
  opts: CleanOptions = {},
): QualityCheck {
  const minAssistantChars = opts.minAssistantChars ?? 4;
  const turns = example.conversation.filter((t) => t.role !== "system");

  if (!turns.some((t) => t.role === "user")) {
    return { ok: false, reason: "no user turn" };
  }
  const assistantTurns = turns.filter((t) => t.role === "assistant");
  if (!assistantTurns.length) {
    return { ok: false, reason: "no assistant turn" };
  }
  if (assistantTurns.some((t) => t.content.trim().length < minAssistantChars)) {
    return { ok: false, reason: "assistant turn too short" };
  }
  if (hasDenylistedAssistantContent(turns)) {
    return { ok: false, reason: "assistant turn matches error/refusal denylist" };
  }
  for (let i = 1; i < assistantTurns.length; i++) {
    if (assistantTurns[i]!.content.trim() === assistantTurns[i - 1]!.content.trim()) {
      return { ok: false, reason: "repeated assistant turn (likely echo/stuck reply)" };
    }
  }
  return { ok: true };
}

/**
 * Normalize turns and apply the quality gate. Returns null (and, if
 * `onDrop` is given, reports why) when the example should be excluded.
 */
export function cleanExample(
  example: TrainingExample,
  opts: CleanOptions & { onDrop?: (example: TrainingExample, reason: string) => void } = {},
): TrainingExample | null {
  const conversation = normalizeTurns(example.conversation);
  const candidate: TrainingExample = { ...example, conversation };
  const check = checkExampleQuality(candidate, opts);
  if (!check.ok) {
    opts.onDrop?.(example, check.reason || "failed quality check");
    return null;
  }
  return candidate;
}

export function cleanExamples(
  examples: TrainingExample[],
  opts: CleanOptions & { onDrop?: (example: TrainingExample, reason: string) => void } = {},
): TrainingExample[] {
  const out: TrainingExample[] = [];
  for (const example of examples) {
    const cleaned = cleanExample(example, opts);
    if (cleaned) out.push(cleaned);
  }
  return out;
}

/** Normalize conversation text into a stable dedupe key (case/whitespace-insensitive). */
function dedupeKey(example: TrainingExample): string {
  return example.conversation
    .filter((t) => t.role !== "system")
    .map((t) => `${t.role}:${t.content.trim().toLowerCase().replace(/\s+/g, " ")}`)
    .join("|");
}

/** Drop exact/near-duplicate conversations, keeping the first occurrence. */
export function dedupeExamples(examples: TrainingExample[]): TrainingExample[] {
  const seen = new Set<string>();
  const out: TrainingExample[] = [];
  for (const example of examples) {
    const key = dedupeKey(example);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(example);
  }
  return out;
}

/** Small stable string hash (FNV-1a) — no crypto dependency needed. */
function stableHash(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export interface SplitResult {
  train: TrainingExample[];
  val: TrainingExample[];
}

/**
 * Deterministic train/val split keyed by example id (stable across runs and
 * across re-exports, so the held-out set doesn't silently change turn by turn).
 */
export function splitExamples(examples: TrainingExample[], valRatio = 0): SplitResult {
  if (valRatio <= 0) return { train: examples.slice(), val: [] };
  const ratio = Math.min(valRatio, 0.5);
  const train: TrainingExample[] = [];
  const val: TrainingExample[] = [];
  for (const example of examples) {
    const bucket = stableHash(example.id) % 1000;
    if (bucket < ratio * 1000) {
      val.push(example);
    } else {
      train.push(example);
    }
  }
  return { train, val };
}
