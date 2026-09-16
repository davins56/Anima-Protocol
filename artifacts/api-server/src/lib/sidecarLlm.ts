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
 */

const POST_TURN_SIDECAR_FUNCTIONS = new Set([
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
  "generateGroupInteraction",
  "generateResponseSuggestions",
  "generateSessionQuests",
  "generateSpecialQuests",
  "generateWorldEvent",
  "ingestSeriesLore",
  "suggestGuestCharacter",
  "suggestSideQuests",
  "suggestWorldEvents",
  "trackCharacterEvolution",
  "updateCharacterEmotion",
  "updateInventory",
  "worldEvolutionOrchestrator",
]);

let companionTurns = 0;

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

export function beginCompanionLlmTurn(): () => void {
  companionTurns += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    companionTurns = Math.max(0, companionTurns - 1);
  };
}

/** Test-only: drop occupancy so cases do not leak across files. */
export function resetCompanionLlmTurnForTests(): void {
  companionTurns = 0;
}

/**
 * True when a sidecar must not call the local LLM.
 * Occupancy always wins. Production/dev skip unless ANIMA_SIDECAR_LLM=1.
 * Vitest keeps sidecars on so extraction tests can mock completions.
 */
export function shouldSkipSidecarLlm(): boolean {
  if (companionTurns > 0) return true;
  if (envFlagTrue(process.env.ANIMA_SIDECAR_LLM)) return false;
  if (envFlagTrue(process.env.VITEST)) return false;
  return true;
}
