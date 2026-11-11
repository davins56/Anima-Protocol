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
 * Fail-closed for true background work: those completions pass `localOnly:
 * true`, which selects `localOnlyProviderChain()` (the self-hosted model
 * only). OpenRouter, OpenAI, and Workers AI are not added to get around
 * the slot.
 *
 * Routes a person triggers and waits on (lesson draft, own-model teacher,
 * codespace, file/image context, non-sidecar `/v1/chat/completions`,
 * `/api/ai/chat`) keep the provider chain, token budget, and timeout they
 * had before this queue. They still refuse to start while the ledger says
 * companion chat is active, and an in-flight local generate stays
 * preemptible. They do not use the short background cap.
 */

import {
  ACTIVE_CHAT_QUIET_WINDOW_MS,
  capBackgroundNumPredict,
  capNumPredict,
  LLM_EVOLUTION_NUM_PREDICT,
  LLM_EVOLUTION_WALL_MS,
  LLM_MEMORY_EXTRACT_NUM_PREDICT,
  LLM_MEMORY_EXTRACT_WALL_MS,
  LLM_BACKGROUND_NUM_PREDICT,
  LLM_BACKGROUND_WALL_MS,
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
  | "memory-policy"
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

/**
 * `short` — 80 tokens and a 12s wall (optional background work).
 * `evolution` / `memory` — JSON jobs with a budget that can parse, and a
 * wall that fits ~9 tokens/s. Still aborted when chat asks the slot to yield.
 * `caller` — user-waited route. Original token budget and timeout. The slot
 * only aborts the call when a companion chat turn wants the model.
 */
export type LocalLlmBudget = "short" | "evolution" | "memory" | "caller";

export type LocalLlmJobPolicy = {
  /** interactive = `/chat/messages`. inline = no model call. background = the slot. */
  priority: "interactive" | "inline" | "background";
  whenActive: ActiveChatBehavior;
  budget: LocalLlmBudget;
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
    budget: "caller",
    notes: "POST /chat/messages generate, including retry, edit, and continue.",
  },
  "mood-affect": {
    priority: "inline",
    whenActive: "run",
    budget: "caller",
    notes: "evolveCompanionAffectFromUser/Companion. No model call.",
  },
  relationship: {
    priority: "inline",
    whenActive: "run",
    budget: "caller",
    notes: "maybeTriggerRelationshipEvolution heuristic. No model call.",
  },
  "turn-memory": {
    priority: "inline",
    whenActive: "run",
    budget: "caller",
    notes: "upsertTurnMemory stores the exchange as a fact. No model call.",
  },
  "narrative-arc": {
    priority: "inline",
    whenActive: "run",
    budget: "caller",
    notes: "maybeTriggerNarrativeArc heuristic. No model call.",
  },
  evolution: {
    priority: "background",
    whenActive: "defer",
    budget: "evolution",
    notes: "Milestone personality delta. Deferred until chat is idle, then the local model at 512 tokens. A truncated or aborted run is re-queued.",
  },
  "memory-extract": {
    priority: "background",
    whenActive: "defer",
    budget: "memory",
    notes: "Distilled characterMemory facts. Deferred until idle, then 256 tokens. The turn fact is already stored. A truncated or aborted run is re-queued.",
  },
  "memory-policy": {
    priority: "background",
    whenActive: "defer",
    budget: "short",
    notes: "Deterministic keep/classify on companion_memories. Deferred until chat is idle. Does not call the model.",
  },
  proactive: {
    priority: "background",
    whenActive: "skip",
    budget: "short",
    notes: "Proactive check-in. Skipped during the quiet window; cron tries again later. Short local cap.",
  },
  journal: {
    priority: "background",
    whenActive: "skip",
    budget: "short",
    notes: "Autonomous journal reflection. Skipped during the quiet window. Short local cap.",
  },
  "llm-warm": {
    priority: "background",
    whenActive: "skip",
    budget: "short",
    notes: "Weight warm-up. Skipped so it cannot sit in front of a reply.",
  },
  sidecar: {
    priority: "background",
    whenActive: "skip",
    budget: "short",
    notes: "Quests, lore, world events, choices, suggestions, and other optional invokes. Short local cap.",
  },
  "scene-mind": {
    priority: "background",
    whenActive: "skip",
    budget: "short",
    notes: "Optional director on POST /scene-mind. Least-recent speaker is used instead. Short local cap.",
  },
  "model-tutor": {
    priority: "background",
    whenActive: "yield",
    budget: "caller",
    notes: "Steward lesson draft. Original chain, 400 tokens, and draft timeout. Does not start while the ledger says chat is active. An in-flight local generate aborts when chat yields.",
  },
  "own-model-teacher": {
    priority: "background",
    whenActive: "yield",
    budget: "caller",
    notes: "Own-model teacher draft. Original chain, 300 tokens, and teacher timeout. Does not start during the quiet window. An in-flight local generate aborts when chat yields.",
  },
  codespace: {
    priority: "background",
    whenActive: "yield",
    budget: "caller",
    notes: "Codespace agent completion. Original heavy token budget and provider chain. Does not start during the quiet window. An in-flight local generate aborts when chat yields.",
  },
  "openai-user": {
    priority: "background",
    whenActive: "yield",
    budget: "caller",
    notes: "Signed-in /v1/chat/completions that is not a post-turn sidecar, including the stream. Original chain, tokens, and open timeout. Does not start during the quiet window.",
  },
  "ai-chat": {
    priority: "background",
    whenActive: "yield",
    budget: "caller",
    notes: "POST /api/ai/chat probe. Original 256-token budget and ai-chat open timeout. Does not start during the quiet window. An in-flight local generate aborts when chat yields.",
  },
  "context-analysis": {
    priority: "background",
    whenActive: "yield",
    budget: "caller",
    notes: "Uploaded file/image context. Original chain and 1500-token budget (vision stays on whatever provider the chain already used). 429 while the ledger says chat is active.",
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

export type LocalLlmJobLimits = {
  budget: LocalLlmBudget;
  /** Null means the caller's own timeout is the wall. Yield abort still applies. */
  wallMs: number | null;
  /** Null means the caller's maxTokens is left alone. */
  tokenCap: number | null;
};

export function localLlmJobLimits(job: LocalLlmJobId): LocalLlmJobLimits {
  const budget = LOCAL_LLM_JOBS[job].budget;
  if (budget === "evolution") {
    return {
      budget,
      wallMs: LLM_EVOLUTION_WALL_MS,
      tokenCap: LLM_EVOLUTION_NUM_PREDICT,
    };
  }
  if (budget === "memory") {
    return {
      budget,
      wallMs: LLM_MEMORY_EXTRACT_WALL_MS,
      tokenCap: LLM_MEMORY_EXTRACT_NUM_PREDICT,
    };
  }
  if (budget === "caller") {
    return { budget, wallMs: null, tokenCap: null };
  }
  return {
    budget,
    wallMs: LLM_BACKGROUND_WALL_MS,
    tokenCap: LLM_BACKGROUND_NUM_PREDICT,
  };
}

/** Clamp to the job cap. Caller-budget jobs return the requested count. */
export function capLocalLlmJobTokens(job: LocalLlmJobId, requested?: number): number {
  const cap = localLlmJobLimits(job).tokenCap;
  if (cap == null) {
    const raw =
      typeof requested === "number" && Number.isFinite(requested) && requested > 0
        ? Math.floor(requested)
        : 0;
    return Math.max(1, raw);
  }
  return capNumPredict(requested, cap);
}

export { ACTIVE_CHAT_QUIET_WINDOW_MS };
