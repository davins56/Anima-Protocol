/**
 * Who may call the single local Ollama model, and what happens while
 * someone is chatting.
 *
 * Interactive `/chat/messages` turns (including retry, edit, and continue)
 * take the slot ahead of every background job. See `localLlmSlot.ts`.
 *
 * Cross-instance "is anyone chatting?" is the Postgres `chat_turns` ledger
 * (`localModelChatIsActive`): a pending turn with a live lease, or any turn
 * created inside `ACTIVE_CHAT_QUIET_WINDOW_MS`. The in-process companion
 * counter covers the moment before that row is visible. The slot Durable
 * Object orders the generate itself. Deferred payloads live in
 * `local_llm_deferred_jobs` so a Worker isolate can exit and a later cron
 * still runs them. In-memory maps are not enough across isolates.
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
 * model (or it is the interactive reply). `yield` may start between
 * messages but aborts when a chat turn arrives. `defer` is persisted and
 * run once the quiet window is clear. `skip` is dropped for this attempt.
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
    notes: "Steward lesson draft. May run between messages; aborts when a chat turn arrives.",
  },
  "own-model-teacher": {
    priority: "background",
    whenActive: "yield",
    notes: "Own-model teacher draft. Yields to an interactive reply.",
  },
  codespace: {
    priority: "background",
    whenActive: "yield",
    notes: "Codespace agent completion. Yields to an interactive reply.",
  },
  "openai-user": {
    priority: "background",
    whenActive: "yield",
    notes: "Signed-in /api/openai completion that is not a post-turn sidecar.",
  },
  "ai-chat": {
    priority: "background",
    whenActive: "yield",
    notes: "POST /api/ai/chat probe. Yields to an interactive reply.",
  },
  "context-analysis": {
    priority: "background",
    whenActive: "yield",
    notes: "Uploaded file/image context. Yields to an interactive reply.",
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
 * True when background work must not start a generate.
 * In-flight companion turns count even before the ledger row is visible.
 * The ledger covers other isolates and the few minutes after a send.
 */
export async function localChatActivityActive(): Promise<boolean> {
  if (companionLlmTurnOpen()) return true;
  if (activityProbe) return activityProbe();
  // Vitest shares one Postgres schema. A fixture turn would quiet every
  // later file. Tests that care set `setLocalChatActivityProbeForTests`.
  // Production always reads the chat_turns ledger.
  if (String(process.env.VITEST || "").trim().toLowerCase() === "true") return false;
  try {
    return await localModelChatIsActive();
  } catch {
    // Unknown activity: do not take the only slot.
    return true;
  }
}

export async function admitBackgroundJob(job: LocalLlmJobId): Promise<BackgroundAdmission> {
  const policy = LOCAL_LLM_JOBS[job];
  if (policy.priority !== "background") return "run";
  const active = await localChatActivityActive();
  if (!active) return "run";
  if (policy.whenActive === "run" || policy.whenActive === "yield") return "run";
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
