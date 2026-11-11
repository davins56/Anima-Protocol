/** A turn-specific nudge, not a filter: never delete a useful question. */
export const DIALOGUE_PATTERN_NOTE =
  "Recent replies keep handing the turn back. Finish a concrete thought this time, without a stock question or invitation. Questions are fine when requested, or for needed clarification or safety.";

type DialogueMessage = {
  role?: unknown;
  content?: unknown;
  character_id?: unknown;
  characterId?: unknown;
  character_name?: unknown;
  characterName?: unknown;
};

function handsTurnBack(content: unknown): boolean {
  const tail = String(content ?? "").slice(-320).trim().replace(/[\s*_`"'“”‘’)\]]+$/gu, "");
  return /[?？؟]$/u.test(tail) ||
    /(?:^|[.!]\s+)(?:tell me more(?: about[^.!?]*)?|go on|what are your thoughts|i(?:'m| am) listening|i(?:'d| would) love to hear (?:more|your thoughts))\s*[.!…]*$/i.test(tail);
}

export function dialogueTurnNote(input: {
  messages: readonly DialogueMessage[];
  speaker?: { id?: unknown; name?: unknown };
  group: boolean;
  careOrTherapy: boolean;
}): string {
  if (input.careOrTherapy) return "";
  const id = String(input.speaker?.id ?? "");
  const name = String(input.speaker?.name ?? "").trim().toLowerCase();
  if (input.group && !id && !name) return "";
  const replies = input.messages.filter((message) => {
    if (message.role !== "assistant" || !String(message.content ?? "").trim()) return false;
    const messageId = String(message.character_id ?? message.characterId ?? "");
    const messageName = String(message.character_name ?? message.characterName ?? "").trim().toLowerCase();
    if (messageName === "__thinking__" || messageName === "__typing__") return false;
    // An explicit identity wins; don't borrow another companion's pattern.
    if (messageId && id) return messageId === id;
    if (messageName) return Boolean(name) && messageName === name;
    if (messageId) return false;
    return !input.group;
  }).slice(-2);
  return replies.length === 2 && replies.every((reply) => handsTurnBack(reply.content))
    ? DIALOGUE_PATTERN_NOTE : "";
}
