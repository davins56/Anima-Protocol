/**
 * Instant group-speaker selection (force / @address / least-recent / interrupt).
 * Mirrors the heuristic path of server Scene Mind so Chat does not wait on an
 * extra HTTP round-trip or director LLM before the companion processes the turn.
 */

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when the user message clearly addresses this character. */
export function isCharacterAddressed(userMessage, characterName) {
  const name = String(characterName || "").trim();
  const text = String(userMessage || "");
  if (!name || !text.trim()) return false;
  const escaped = escapeRegExp(name);
  return new RegExp(`@${escaped}\\b`, "i").test(text) || new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function recentAssistantNames(recentMessages = []) {
  return new Set(
    (recentMessages || [])
      .slice(-6)
      .filter(
        (m) =>
          m?.role === "assistant" &&
          m.character_name !== "Narrator" &&
          m.character_name !== "__typing__" &&
          m.character_name !== "__thinking__" &&
          !m.is_streaming,
      )
      .map((m) => m.character_name)
      .filter(Boolean),
  );
}

/**
 * @returns {{ character: object | null, interrupted: boolean, reason: string }}
 */
export function pickGroupSpeaker({
  groupChars = [],
  eligibleChars,
  userMessage = "",
  recentMessages = [],
  forceCharacterId = null,
  isContinue = false,
  random = Math.random,
  interruptChance = 0.35,
} = {}) {
  const participants = (groupChars || []).filter((c) => c?.id && c?.name);
  if (!participants.length) {
    return { character: null, interrupted: false, reason: "fallback" };
  }

  const forced = forceCharacterId
    ? participants.find((c) => c.id === forceCharacterId)
    : null;
  if (forced) {
    return { character: forced, interrupted: false, reason: "forced" };
  }

  const pool = (eligibleChars?.length ? eligibleChars : participants).filter(
    (c) => c?.id && c?.name,
  );
  const usable = pool.length ? pool : participants;

  if (String(userMessage || "").trim() && !isContinue) {
    const addressed = usable.filter((c) => isCharacterAddressed(userMessage, c.name));
    if (addressed.length === 1) {
      return { character: addressed[0], interrupted: false, reason: "addressed" };
    }
  }

  const recentNames = recentAssistantNames(recentMessages);
  const preferred =
    usable.find((c) => !recentNames.has(c.name)) || usable[0];

  const allowInterrupt =
    !isContinue && usable.length >= 2 && random() < interruptChance;
  if (allowInterrupt) {
    const interrupter = usable.find((c) => c.id !== preferred.id);
    if (interrupter) {
      return { character: interrupter, interrupted: true, reason: "interrupt" };
    }
  }

  return { character: preferred, interrupted: false, reason: "least_recent" };
}
