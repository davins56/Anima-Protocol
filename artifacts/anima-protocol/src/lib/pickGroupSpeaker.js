/**
 * Instant group-speaker selection (force / address queue / random / interrupt).
 * Uses pickNextSpeakers so Chat does not wait on an extra HTTP round-trip or
 * director LLM before the companion processes the turn.
 *
 * Interrupt is OFF by default. Pass interruptChance explicitly to re-enable it.
 */
import { builtInCompanionFor } from "@/lib/companions/builtInCompanions";
import { isCharacterAddressed, pickNextSpeakers } from "./pickNextSpeakers";

export { isCharacterAddressed, pickNextSpeakers };

function asList(value) {
  if (value == null || value === "") return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueTerms(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const term = String(value || "").trim();
    if (!term) continue;
    const key = term.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(term);
  }
  return out;
}

/** Nickname / alias fields plus built-in companion aliases when the name matches. */
export function aliasesForParticipant(character) {
  if (!character) return [];
  const builtin = builtInCompanionFor(character);
  return uniqueTerms([
    character.nickname,
    character.aka,
    ...asList(character.aliases),
    ...(builtin?.aliases || []),
  ]);
}

function withAliases(character) {
  if (!character) return character;
  return { ...character, aliases: aliasesForParticipant(character) };
}

/**
 * @returns {{ character: object | null, interrupted: boolean, reason: string, speakers: object[] }}
 */
export function pickGroupSpeaker({
  groupChars = [],
  eligibleChars,
  userMessage = "",
  recentMessages = [],
  forceCharacterId = null,
  isContinue = false,
  random = Math.random,
  interruptChance = 0,
} = {}) {
  const participants = (groupChars || []).filter((c) => c?.id && c?.name).map(withAliases);
  if (!participants.length) {
    return { character: null, interrupted: false, reason: "fallback", speakers: [] };
  }

  const eligibleIds = (eligibleChars?.length ? eligibleChars : [])
    .map((c) => c?.id)
    .filter(Boolean);

  const pick = pickNextSpeakers({
    participants,
    latestMessage: userMessage,
    recentMessages,
    forceCharacterId,
    eligibleCharacterIds: eligibleIds.length ? eligibleIds : null,
    rng: random,
  });

  // Optional out-of-turn reaction, off by default. Never interrupts a forced
  // pin or a character who was just addressed.
  const chance =
    typeof interruptChance === "number" ? Math.min(1, Math.max(0, interruptChance)) : 0;
  const allowInterrupt =
    !isContinue &&
    pick.reason === "random" &&
    participants.length >= 2 &&
    chance > 0 &&
    random() < chance;
  if (allowInterrupt) {
    const preferred = pick.next;
    const interrupter = participants.find((c) => c.id !== preferred?.id);
    if (interrupter) {
      return {
        character: interrupter,
        interrupted: true,
        reason: "interrupt",
        speakers: [interrupter],
      };
    }
  }

  return {
    character: pick.next,
    interrupted: false,
    reason: pick.reason,
    speakers: pick.speakers,
  };
}
