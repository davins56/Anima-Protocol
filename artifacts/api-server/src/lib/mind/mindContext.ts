/**
 * Per-turn knowledge for the chat mind: identity anchor, durable user
 * facts, the rolling summary of this conversation, and recalled moments,
 * ranked together and packed to a token budget. Replaces the fixed-size
 * memory-core block (8 recalls, 1,800 chars, no facts, no summary) on the
 * hosted path.
 */
import { continuityPromptBlock } from "../continuity/continuityCore";
import { loadCompanionState } from "../continuity/continuityStore";
import { ensureIdentitySnapshot, recallMemories, type RecalledMemory } from "../memoryCore/memoryCore";
import { formatMemoryCoreBlock, isMemoryCoreEnabled } from "../memoryCore/sessionContext";
import {
  formatKnowledgeBlock,
  packKnowledge,
  rankKnowledge,
  type KnowledgeCandidate,
} from "./hybridRecall";
import type { MindProfile } from "./profile";
import { loadSessionSummary, SESSION_SUMMARY_KIND } from "./rollingSummary";
import { loadUserFacts, USER_FACT_KIND, type UserFact } from "./userFacts";

/** Each loader gives up here so the block still beats the 1.2s optional-context budget. */
export const MIND_CONTEXT_TIMEOUT_MS = 900;

const MIND_NOTE_KINDS = new Set([USER_FACT_KIND, SESSION_SUMMARY_KIND]);

/** Turn rows from three stores into one candidate list. */
export function knowledgeCandidates(facts: UserFact[], recalled: RecalledMemory[]): KnowledgeCandidate[] {
  const out: KnowledgeCandidate[] = facts.map((f, i) => ({
    id: f.id || `fact-${i}`,
    kind: "fact",
    text: f.fact,
    occurredAt: f.occurredAt ?? null,
    importance: f.importance,
    similarity: null,
  }));
  for (const m of recalled) {
    const kind = String((m.payload as { kind?: unknown } | null)?.kind || "");
    // Facts / summaries arrive through their own loaders.
    if (m.event_type === "note" && MIND_NOTE_KINDS.has(kind)) continue;
    if (m.event_type === "retraction" || m.event_type === "recall") continue;
    out.push({
      id: m.id,
      kind: "moment",
      text: m.content,
      occurredAt: m.occurred_at,
      importance: m.emotional_weight,
      similarity: typeof m.similarity === "number" ? m.similarity : null,
    });
  }
  return out;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}

export async function buildMindKnowledge(args: {
  userId: string;
  character: { id?: unknown; [k: string]: unknown } | null | undefined;
  sessionId: string;
  query: string;
  profile: MindProfile;
  historyTexts: string[];
  userName?: string;
}): Promise<string> {
  if (!isMemoryCoreEnabled() || !args.character?.id) return "";
  const characterId = String(args.character.id);
  const soft = <T>(p: Promise<T>, fallback: T) =>
    withTimeout(p.catch(() => fallback), MIND_CONTEXT_TIMEOUT_MS, fallback);
  const [identity, facts, summary, recalled, continuity] = await Promise.all([
    soft(ensureIdentitySnapshot(args.userId, args.character), null),
    soft(loadUserFacts(args.userId, characterId, args.profile.factLimit * 2), [] as UserFact[]),
    soft(loadSessionSummary(args.userId, characterId, args.sessionId), null),
    soft(
      recallMemories({
        userId: args.userId,
        characterId,
        query: args.query,
        limit: args.profile.recallLimit,
        sessionId: args.sessionId,
      }),
      [] as RecalledMemory[],
    ),
    soft(loadCompanionState(args.userId, characterId), null),
  ]);
  const ranked = rankKnowledge(knowledgeCandidates(facts, recalled), {
    query: args.query,
    historyTexts: args.historyTexts,
  });
  const packed = packKnowledge(ranked, summary?.text || "", args.profile.knowledgeTokens, {
    facts: args.profile.factLimit,
    moments: 10,
  });
  const anchor = identity ? formatMemoryCoreBlock(identity, []) : "";
  return [anchor, formatKnowledgeBlock(packed, { userName: args.userName }), continuity ? continuityPromptBlock(continuity) : ""]
    .filter(Boolean)
    .join("\n\n");
}
