/**
 * Data-quality pass for fine-tune examples: drop error/placeholder artifacts,
 * collapse accidental duplicate turns, redact obvious PII, filter out
 * low-signal conversations, and de-duplicate near-identical transcripts.
 *
 * Quality > quantity — this trims noisy bulk exports down to turns worth
 * training on, without needing a human to hand-review every session.
 */

import { createHash } from "node:crypto";
import type { ChatTurn, TrainingExample } from "./types";

/** Artifacts that leak into transcripts from failed turns, not real replies. */
const ARTIFACT_RE =
  /^(the companion returned an empty reply\.?( please try again\.?)?|error:.*|\.\.\.|undefined|null|\[object object\])$/i;

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const PHONE_RE = /\b(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

export interface CleanOptions {
  /** Minimum non-system turns remaining after per-turn cleaning (default 4). */
  minTurns?: number;
  /** Below this average assistant reply length, the example is dropped (default 12). */
  minAvgAssistantChars?: number;
  /** Redact emails / phone numbers found in turn content (default true). */
  redactPii?: boolean;
}

const DEFAULTS: Required<CleanOptions> = {
  minTurns: 4,
  minAvgAssistantChars: 12,
  redactPii: true,
};

function redact(text: string): string {
  return text.replace(EMAIL_RE, "[email]").replace(PHONE_RE, "[phone]");
}

/**
 * Per-turn cleanup: trim, drop empty/error-artifact turns, collapse
 * consecutive duplicate turns from the same role (accidental double-sends).
 */
export function cleanTurns(turns: ChatTurn[], opts: CleanOptions = {}): ChatTurn[] {
  const { redactPii } = { ...DEFAULTS, ...opts };
  const cleaned: ChatTurn[] = [];

  for (const turn of turns) {
    const trimmed = (turn.content || "").trim();
    if (!trimmed || ARTIFACT_RE.test(trimmed)) continue;

    const content = redactPii ? redact(trimmed) : trimmed;
    const prev = cleaned[cleaned.length - 1];
    if (prev && prev.role === turn.role && prev.content === content) {
      // Accidental duplicate send/regenerate — keep the first occurrence only.
      continue;
    }
    cleaned.push({ ...turn, content });
  }

  return cleaned;
}

/** True when an example is too thin or low-signal to train on. */
export function isLowQuality(example: TrainingExample, opts: CleanOptions = {}): boolean {
  const { minTurns, minAvgAssistantChars } = { ...DEFAULTS, ...opts };
  const turns = example.conversation.filter((t) => t.role !== "system");
  if (turns.length < minTurns) return true;

  const assistantTurns = turns.filter((t) => t.role === "assistant");
  if (assistantTurns.length === 0) return true;

  const avgLen =
    assistantTurns.reduce((sum, t) => sum + t.content.length, 0) / assistantTurns.length;
  if (avgLen < minAvgAssistantChars) return true;

  return false;
}

/** Stable hash of the normalized conversation, used to drop near-identical examples. */
export function conversationFingerprint(example: TrainingExample): string {
  const normalized = example.conversation
    .filter((t) => t.role !== "system")
    .map((t) => `${t.role}:${t.content.trim().toLowerCase().replace(/\s+/g, " ")}`)
    .join("\n");
  return createHash("sha1").update(normalized).digest("hex");
}

/**
 * Full pipeline: clean turns, drop low-quality examples, then drop
 * near-identical duplicates (keeping the first occurrence — seed examples are
 * merged before DB transcripts, so curated data wins ties).
 */
export function cleanExamples(
  examples: TrainingExample[],
  opts: CleanOptions = {},
): { kept: TrainingExample[]; dropped: number; deduped: number } {
  const seen = new Set<string>();
  const kept: TrainingExample[] = [];
  let dropped = 0;
  let deduped = 0;

  for (const example of examples) {
    const conversation = cleanTurns(example.conversation, opts);
    const candidate: TrainingExample = { ...example, conversation };

    if (isLowQuality(candidate, opts)) {
      dropped++;
      continue;
    }

    const fingerprint = conversationFingerprint(candidate);
    if (seen.has(fingerprint)) {
      deduped++;
      continue;
    }
    seen.add(fingerprint);
    kept.push(candidate);
  }

  return { kept, dropped, deduped };
}
