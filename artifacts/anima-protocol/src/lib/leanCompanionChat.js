/**
 * Lean 1:1 companion chat extras.
 *
 * Chat.jsx used to send a full character sheet, 14-message transcript, user
 * profile, and guardrails as `system_prompt`. The server already owns identity,
 * store history, memories, and safety via `composePrompt`. Shipping that blob
 * again inflates prefill and delays first token.
 *
 * Solo turns send only scene extras the server does not have (lore, calendar,
 * injected memories, companion-mode / Lover Matrix, length, image tags).
 */

export const LEAN_SOLO_CLIENT_CONTEXT_MAX = 2000;

function trimBlock(value) {
  return String(value || "").trim();
}

/**
 * Compact untrusted extras for POST /chat/messages `system_prompt`.
 * Empty string = server uses CORE_BEHAVIOR + CHARACTER from the store.
 */
export function buildLeanSoloClientContext({
  companionModeInstruction = "",
  behaviorInstructions = "",
  adultInstruction = "",
  intimatePlayAlong = "",
  matrixSafetyClause = "",
  injectedMemoryContext = "",
  loreContext = "",
  calendarContext = "",
  fragmentContext = "",
  vesselContext = "",
  lengthGuide = "",
  imageInstruction = "",
  isContinue = false,
  characterName = "",
} = {}) {
  const continueLine =
    isContinue && characterName
      ? `The user tapped Continue — keep the scene moving as ${characterName}. Take the next natural beat, then stop at a clear pause point so they can react.`
      : "";
  const joined = [
    companionModeInstruction,
    behaviorInstructions,
    adultInstruction,
    intimatePlayAlong,
    matrixSafetyClause,
    injectedMemoryContext,
    loreContext,
    calendarContext,
    fragmentContext,
    vesselContext,
    lengthGuide,
    imageInstruction,
    continueLine,
  ]
    .map(trimBlock)
    .filter(Boolean)
    .join("\n\n");
  if (!joined) return "";
  if (joined.length <= LEAN_SOLO_CLIENT_CONTEXT_MAX) return joined;
  return `${joined.slice(0, LEAN_SOLO_CLIENT_CONTEXT_MAX - 1)}…`;
}

/** Deep mode is an explicit session toggle — not "what is" / "explain" regex. */
export function companionChatDeepMode(session) {
  return Boolean(session?.deep_mode);
}
