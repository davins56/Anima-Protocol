/**
 * After the reply has streamed: learn from the turn without touching
 * time-to-first-token. Runs inside the existing post-stream background block
 * (ctx.waitUntil on the Worker) on the background model.
 *
 * 1. Extract durable user facts → memory_events notes (kind user_fact).
 * 2. Roll the conversation summary forward when enough history aged out.
 */
import { createChatCompletionWithFailover, localOnlyProviderChain } from "../llmFailover";
import type { MindProfile } from "./profile";
import {
  buildSummaryMessages,
  loadSessionSummary,
  parseSummary,
  planSummaryRollover,
  storeSessionSummary,
  type SummaryMessage,
} from "./rollingSummary";
import {
  buildFactExtractionMessages,
  loadUserFacts,
  parseExtractedFacts,
  storeUserFacts,
  type FactScope,
} from "./userFacts";

export type MindPostTurnInput = {
  userId: string;
  characterId: string;
  sessionId: string;
  turnId?: string | null;
  userMessage: string;
  companionReply: string;
  userName?: string;
  companionName?: string;
  profile: MindProfile;
  /**
   * `user` (default): learned facts are shared with all of this user's
   * companions. `companion`: kept private to this one (therapy / adult).
   */
  factScope?: FactScope;
  /** Loads the recent tail of this session (ascending). */
  loadRecentMessages: (limit: number) => Promise<Array<{ seq?: unknown; role?: unknown; content?: unknown }>>;
};

/** Small user lines ("ok", "haha") carry no facts; skip the model call. */
export function worthExtracting(userMessage: string): boolean {
  const words = String(userMessage || "").trim().split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

async function backgroundComplete(messages: Array<{ role: "system" | "user"; content: string }>, maxTokens: number) {
  const result = await createChatCompletionWithFailover({
    tier: "light",
    maxTokens,
    temperature: 0.2,
    messages,
    localOnly: true,
  });
  return String(result.content || "");
}

export async function extractAndStoreFacts(input: MindPostTurnInput): Promise<number> {
  if (!worthExtracting(input.userMessage)) return 0;
  const known = await loadUserFacts(input.userId, input.characterId, 60);
  const raw = await backgroundComplete(
    buildFactExtractionMessages({
      userName: input.userName,
      companionName: input.companionName,
      userMessage: input.userMessage,
      companionReply: input.companionReply,
      knownFacts: known.slice(0, 30).map((f) => f.fact),
    }),
    320,
  );
  const facts = parseExtractedFacts(raw);
  if (!facts.length) return 0;
  return storeUserFacts({
    userId: input.userId,
    characterId: input.characterId,
    sessionId: input.sessionId,
    turnId: input.turnId,
    facts,
    known,
    scope: input.factScope ?? "user",
  });
}

export function toSummaryMessages(rows: Array<{ seq?: unknown; role?: unknown; content?: unknown }>): SummaryMessage[] {
  const out: SummaryMessage[] = [];
  for (const r of rows) {
    const seq = r.seq == null || r.seq === "" ? Number.NaN : Number(r.seq);
    const role = r.role === "user" ? "user" : r.role === "assistant" ? "assistant" : null;
    const content = String(r.content ?? "").trim();
    if (!Number.isFinite(seq) || !role || !content) continue;
    out.push({ seq, role, content });
  }
  return out;
}

export async function rollSummaryForward(input: MindPostTurnInput): Promise<boolean> {
  const windowMessages = input.profile.historyExchanges * 2;
  const [rows, previous] = await Promise.all([
    input.loadRecentMessages(windowMessages + 60),
    loadSessionSummary(input.userId, input.characterId, input.sessionId),
  ]);
  const plan = planSummaryRollover({ messages: toSummaryMessages(rows), previous, windowMessages });
  if (!plan) return false;
  const raw = await backgroundComplete(
    buildSummaryMessages({
      previous: previous?.text || "",
      messages: plan.messages,
      userName: input.userName,
      companionName: input.companionName,
    }),
    420,
  );
  const summary = parseSummary(raw);
  if (!summary) return false;
  const id = await storeSessionSummary({
    userId: input.userId,
    characterId: input.characterId,
    sessionId: input.sessionId,
    summary,
    throughSeq: plan.throughSeq,
  });
  return Boolean(id);
}

/** True when a background model exists to do this work. */
export function mindPostTurnAvailable(): boolean {
  return localOnlyProviderChain().length > 0;
}

export async function runMindPostTurn(
  input: MindPostTurnInput,
  log: (msg: string, meta: Record<string, unknown>) => void = () => {},
): Promise<void> {
  if (!mindPostTurnAvailable()) return;
  const [facts, summary] = await Promise.allSettled([extractAndStoreFacts(input), rollSummaryForward(input)]);
  log("chat mind post-turn", {
    turnId: input.turnId,
    factsStored: facts.status === "fulfilled" ? facts.value : `error: ${String((facts as PromiseRejectedResult).reason)}`,
    summaryRolled: summary.status === "fulfilled" ? summary.value : `error: ${String((summary as PromiseRejectedResult).reason)}`,
  });
}
