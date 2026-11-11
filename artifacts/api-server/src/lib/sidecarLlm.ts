/**
 * Post-turn sidecar LLM jobs (emotion / memory / inventory / lore / …)
 * share the same self-hosted Ollama process as companion generate.
 * On a single-CPU host they queue behind — or in front of — the next user
 * turn and blow the /api/chat/messages open budget.
 *
 * Companion generate takes an exclusive occupancy slot. Sidecar callers
 * skip when a stream is open. Outside tests they also skip unless
 * ANIMA_SIDECAR_LLM is explicitly enabled, so production local-only
 * chat never queue-starves itself. User-initiated invokes (companion
 * create, codespace) do not use this helper.
 *
 * This counter lives in the current isolate. The cross-isolate lease for
 * the local Ollama host is `localLlmSlot.ts` (Durable Object).
 */

import { combineAbortSignals } from "./chatTimeouts";

const POST_TURN_SIDECAR_FUNCTIONS = new Set([
  "aggregatePersonalityShifts",
  "analyzeCharacterForBehavior",
  "analyzeEmotionalClimate",
  "analyzeMessageTags",
  "analyzeNarrativeContext",
  "applyNarrativeItemEvents",
  "autoEvolveWorldState",
  "characterMemory",
  "detectQuestsFromNarrative",
  "evolveCharacter",
  "extractLore",
  "generateChoices",
  "generateDivergentPaths",
  "generateGroupInteraction",
  "generateResponseSuggestions",
  "generateSessionQuests",
  "generateSpecialQuests",
  "generateWorldEvent",
  "ingestSeriesLore",
  "scanAndLinkLoreKeywords",
  "suggestGuestCharacter",
  "suggestSideQuests",
  "suggestWorldEvents",
  "trackCharacterEvolution",
  "updateCharacterEmotion",
  "updateInventory",
  "worldEvolutionOrchestrator",
]);

let companionTurns = 0;
const companionTurnsByUser = new Map<string, number>();
let backgroundAbort = new AbortController();

/** Signal for LLM work that is not the companion reply. Aborted when a turn starts. */
export function backgroundLlmSignal(): AbortSignal {
  return backgroundAbort.signal;
}

function preemptBackgroundLlm(): void {
  const previous = backgroundAbort;
  backgroundAbort = new AbortController();
  if (!previous.signal.aborted) previous.abort();
}

/**
 * Abort signal for a local completion.
 * Companion occupancy (ensemble drafts inside the turn) keeps the caller
 * signal only, so the turn does not abort itself. Background completions
 * share `backgroundLlmSignal()` and are cancelled when a chat turn begins.
 */
export function localCallSignal(caller?: AbortSignal): AbortSignal | undefined {
  if (companionTurns > 0) return caller;
  const background = backgroundAbort.signal;
  if (!caller) return background;
  return combineAbortSignals(caller, background);
}

function envFlagTrue(value: string | undefined): boolean {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

export function isPostTurnSidecarFunction(fnName: string): boolean {
  return POST_TURN_SIDECAR_FUNCTIONS.has(String(fnName || "").trim());
}

export function companionLlmTurnOpen(): boolean {
  return companionTurns > 0;
}

/** Open companion generates for one Clerk user. The current turn counts. */
export function companionTurnsOpenForUser(userId: string): number {
  const id = String(userId || "").trim();
  if (!id) return 0;
  return companionTurnsByUser.get(id) ?? 0;
}

export function userHasOpenCompanionTurn(userId: string): boolean {
  return companionTurnsOpenForUser(userId) > 0;
}

/**
 * Take the single local slot when it is idle.
 * Check and increment stay synchronous so two probes cannot both pass.
 * Returns null when a companion turn or another probe already holds it.
 */
export function tryBeginCompanionLlmTurn(userId?: string): (() => void) | null {
  if (companionTurns > 0) return null;
  return beginCompanionLlmTurn(userId);
}

export function beginCompanionLlmTurn(userId?: string): () => void {
  companionTurns += 1;
  const id = String(userId || "").trim();
  if (id) companionTurnsByUser.set(id, (companionTurnsByUser.get(id) ?? 0) + 1);
  preemptBackgroundLlm();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    companionTurns = Math.max(0, companionTurns - 1);
    if (!id) return;
    const next = (companionTurnsByUser.get(id) ?? 1) - 1;
    if (next <= 0) companionTurnsByUser.delete(id);
    else companionTurnsByUser.set(id, next);
  };
}

/** Test-only: drop occupancy so cases do not leak across files. */
export function resetCompanionLlmTurnForTests(): void {
  companionTurns = 0;
  companionTurnsByUser.clear();
  backgroundAbort = new AbortController();
}

/**
 * True when this process is allowed to run sidecar LLM at all.
 * Production leaves it off unless ANIMA_SIDECAR_LLM=1. Vitest leaves it on
 * so extraction tests can mock completions. Occupancy is a separate check.
 */
export function sidecarLlmFeatureEnabled(): boolean {
  if (envFlagTrue(process.env.ANIMA_SIDECAR_LLM)) return true;
  if (envFlagTrue(process.env.VITEST)) return true;
  return false;
}

/**
 * True when a sidecar must not call the local LLM.
 * Occupancy always wins. Production/dev skip unless ANIMA_SIDECAR_LLM=1.
 * Vitest keeps sidecars on so extraction tests can mock completions.
 */
export function shouldSkipSidecarLlm(): boolean {
  if (companionTurns > 0) return true;
  return !sidecarLlmFeatureEnabled();
}
