/**
 * Who may call the single local Ollama model, and what happens while
 * someone is chatting.
 *
 * Interactive `/chat/messages` turns (including retry, edit, and continue)
 * take the slot ahead of every background job. See `localLlmSlot.ts`.
 *
 * Ollama serves generates strictly in arrival order and one at a time.
 * A background job must read shared storage and refuse to send before it
 * opens its HTTP request. The Worker runs each request and each cron in
 * its own isolate, so that signal is the Postgres `chat_turns` ledger
 * (`localModelChatIsActive`): a pending turn with a live lease, or any
 * turn created inside `ACTIVE_CHAT_QUIET_WINDOW_MS`. The in-process
 * companion counter is only a same-isolate hint for the moment before
 * that row is visible. It never authorizes a send on its own.
 * The slot Durable Object orders who may generate after that check.
 * Deferred payloads live in `local_llm_deferred_jobs` so a Worker isolate
 * can exit and a later cron still runs them.
 *
 * Fail-closed: background completions pass `localOnly: true`, which selects
 * `localOnlyProviderChain()` (the self-hosted model only). OpenRouter,
 * OpenAI, and Workers AI are not added to get around the slot.
 */

import {
  ACTIVE_CHAT_QUIET_WINDOW_MS,
  capBackgroundNumPredict,
} from "./chatTimeouts";
import { localModelChatIsActive } from "./chatTurnLedger";
import { localOnlyProviderChain, type LlmProviderId } from "./llmFailover";
import { companionLlmTurnOpen } from "./sidecarLlm";

export type LocalLlmJobId =
  | "chat-reply"
  | "proactive"
  | "journal"
  | "llm-warm"
  | "evolution"
  | "memory-extract"
  | "mood-affect"
  | "relationship"
  | "turn-memory"
  | "narrative-arc"
  | "sidecar"
  | "scene-mind"
  | "model-tutor"
  | "own-model-teacher"
  | "codespace"
  | "openai-user"
  | "ai-chat"
  | "context-analysis";

/** What a job does while a chat turn is in flight or inside the quiet window. */
export type ActiveChatBehavior = "run" | "defer" | "skip" | "yield";

export type LocalLlmJobPolicy = {
  /** interactive = `/chat/messages`. inline = no model call. background = the slot. */
  priority: "interactive" | "inline" | "background";
  whenActive: ActiveChatBehavior;
  notes: string;
};

/**
 * Call-site policy. `run` while active means the work does not take the
 * model (or it is the interactive reply). `yield` does not start a new
 * request while the ledger says chat is active — Ollama would queue that
 * request ahead of the reply. A generate that already started is aborted
 * by closing its HTTP connection. `defer` is persisted and run once the
 * quiet window is clear. `skip` is dropped for this attempt.
 */
export const LOCAL_LLM_JOBS: Record<LocalLlmJobId, LocalLlmJobPolicy> = {
  "chat-reply": {
    priority: "interactive",
    whenActive: "run",
    notes: "POST /chat/messages generate, including retry, edit, and continue.",
  },
  "mood-affect": {
    priority: "inline",
    whenActive: "run",
    notes: "evolveCompanionAffectFromUser/Companion. No model call.",
  },
  relationship: {
    priority: "inline",
    whenActive: "run",
    notes: "maybeTriggerRelationshipEvolution heuristic. No model call.",
  },
  "turn-memory": {
    priority: "inline",
    whenActive: "run",
    notes: "upsertTurnMemory stores the exchange as a fact. No model call.",
  },
  "narrative-arc": {
    priority: "inline",
    whenActive: "run",
    notes: "maybeTriggerNarrativeArc heuristic. No model call.",
  },
  evolution: {
    priority: "background",
    whenActive: "defer",
    notes: "Milestone personality delta. Deferred until chat is idle, then the local model.",
  },
  "memory-extract": {
    priority: "background",
    whenActive: "defer",
    notes: "Distilled characterMemory facts. Deferred until idle. The turn fact is already stored.",
  },
  proactive: {
    priority: "background",
    whenActive: "skip",
    notes: "Proactive check-in. Skipped during the quiet window; cron tries again later.",
  },
  journal: {
    priority: "background",
    whenActive: "skip",
    notes: "Autonomous journal reflection. Skipped during the quiet window.",
  },
  "llm-warm": {
    priority: "background",
    whenActive: "skip",
    notes: "Weight warm-up. Skipped so it cannot sit in front of a reply.",
  },
  sidecar: {
    priority: "background",
    whenActive: "skip",
    notes: "Quests, lore, world events, choices, suggestions, and other optional invokes.",
  },
  "scene-mind": {
    priority: "background",
    whenActive: "skip",
    notes: "Optional director on POST /scene-mind. Least-recent speaker is used instead.",
  },
  "model-tutor": {
    priority: "background",
    whenActive: "yield",
    notes: "Steward lesson draft. Does not start while the ledger says chat is active. An in-flight draft aborts by closing the Ollama request.",
  },
  "own-model-teacher": {
    priority: "background",
    whenActive: "yield",
    notes: "Own-model teacher draft. Does not start during the quiet window. An in-flight draft aborts by closing the Ollama request.",
  },
  codespace: {
    priority: "background",
    whenActive: "yield",
    notes: "Codespace agent completion. Does not start during the quiet window. An in-flight call aborts by closing the Ollama request.",
  },
  "openai-user": {
    priority: "background",
    whenActive: "yield",
    notes: "Signed-in /api/openai completion that is not a post-turn sidecar. Does not start during the quiet window.",
  },
  "ai-chat": {
    priority: "background",
    whenActive: "yield",
    notes: "POST /api/ai/chat probe. Does not start during the quiet window. An in-flight call aborts by closing the Ollama request.",
  },
  "context-analysis": {
    priority: "background",
    whenActive: "yield",
    notes: "Uploaded file/image context. Does not start during the quiet window.",
  },
};

export type BackgroundAdmission = "run" | "defer" | "skip";

let activityProbe: (() => Promise<boolean>) | null = null;

/** Test-only. `null` restores the ledger plus the in-process turn counter. */
export function setLocalChatActivityProbeForTests(
  probe: (() => Promise<boolean>) | null,
): void {
  activityProbe = probe;
}

/**
 * True when a background job must not open an Ollama request.
 *
 * Production always reads `chat_turns`. A same-isolate companion counter
 * can only add "active" (the row may not be visible yet). It cannot clear
 * the ledger, and another isolate cannot see it. Tests set
 * `setLocalChatActivityProbeForTests` instead of sharing one schema's
 * fixture turns. A ledger error is treated as active so the job does not send.
 */
async function sharedChatActivity(): Promise<boolean> {
  if (activityProbe) return activityProbe();
  // Vitest shares one Postgres schema. A fixture turn would quiet every
  // later file. Tests that care set `setLocalChatActivityProbeForTests`.
  if (String(process.env.VITEST || "").trim().toLowerCase() === "true") return false;
  try {
    return await localModelChatIsActive();
  } catch {
    return true;
  }
}

/**
 * `ledgerOnly` is for a caller that already took the same-isolate companion
 * counter for itself (the `/api/ai/chat` probe). That counter is not visible
 * to other isolates and must not block the caller's own request. Other
 * isolates are still seen through `chat_turns`.
 */
export async function localChatActivityActive(opts?: {
  ledgerOnly?: boolean;
}): Promise<boolean> {
  if (await sharedChatActivity()) return true;
  if (opts?.ledgerOnly) return false;
  return companionLlmTurnOpen();
}

export async function admitBackgroundJob(
  job: LocalLlmJobId,
  opts?: { ledgerOnly?: boolean },
): Promise<BackgroundAdmission> {
  const policy = LOCAL_LLM_JOBS[job];
  if (policy.priority !== "background") return "run";
  const active = await localChatActivityActive(opts);
  if (!active) return "run";
  // Yield used to mean "start anyway and abort later". Ollama would already
  // have that request queued ahead of the reply. Do not send.
  if (policy.whenActive === "yield" || policy.whenActive === "skip") return "skip";
  return policy.whenActive;
}

/** True when a failed acquire should be remembered instead of dropped. */
export function backgroundJobDefers(job: LocalLlmJobId): boolean {
  return LOCAL_LLM_JOBS[job].whenActive === "defer";
}

/**
 * Provider chain for background generates. Always the self-hosted model,
 * never OpenRouter / Workers AI / a cloud flagship, even when fallback
 * flags and keys are set.
 */
export function backgroundProviderChain(): LlmProviderId[] {
  return localOnlyProviderChain();
}

export function backgroundMaxTokens(requested: number | undefined): number {
  return capBackgroundNumPredict(requested);
}

export { ACTIVE_CHAT_QUIET_WINDOW_MS };
