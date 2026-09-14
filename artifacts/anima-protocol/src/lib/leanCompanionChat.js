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

function capBlock(text, max) {
  if (text.length <= max) return text;
  if (max <= 1) return "…";
  return `${text.slice(0, max - 1)}…`;
}

function takeBlocks(blocks, max) {
  const out = [];
  let used = 0;
  for (const raw of blocks) {
    const block = trimBlock(raw);
    if (!block) continue;
    const sep = out.length ? 2 : 0;
    if (used + sep + block.length <= max) {
      out.push(block);
      used += sep + block.length;
      continue;
    }
    const remain = max - used - sep;
    if (remain > 24) out.push(capBlock(block, remain));
    break;
  }
  return out;
}

function packLeanBlocks(leading, trailing, max) {
  const trail = takeBlocks(trailing, max);
  const trailText = trail.join("\n\n");
  const reserved = trailText ? trailText.length + 2 : 0;
  const lead = takeBlocks(leading, Math.max(0, max - reserved));
  const packed = [...lead, ...trail].filter(Boolean).join("\n\n");
  return packed.length <= max ? packed : capBlock(packed, max);
}

/**
 * Compact untrusted extras for POST /chat/messages `system_prompt`.
 * Empty string = server uses CORE_BEHAVIOR + CHARACTER from the store.
 * Trailing matrix-safety / length / image / Continue lines are reserved so a
 * fat lore or behavior block cannot slice them off at the 2k cap.
 */
export function buildLeanSoloClientContext({
  companionModeInstruction = "",
  behaviorInstructions = "",
  adultInstruction = "",
  intimatePlayAlong = "",
  matrixSafetyClause = "",
  userProfileContext = "",
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
  return packLeanBlocks(
    [
      companionModeInstruction,
      behaviorInstructions,
      adultInstruction,
      intimatePlayAlong,
      userProfileContext,
      injectedMemoryContext,
      loreContext,
      calendarContext,
      fragmentContext,
      vesselContext,
    ],
    [matrixSafetyClause, lengthGuide, imageInstruction, continueLine],
    LEAN_SOLO_CLIENT_CONTEXT_MAX,
  );
}

/** Deep mode is an explicit session toggle — not "what is" / "explain" regex. */
export function companionChatDeepMode(session) {
  return Boolean(session?.deep_mode);
}
