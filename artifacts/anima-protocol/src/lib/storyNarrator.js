/**
 * Story-mode narrator.
 *
 * In story mode a neutral Narrator steps into the chat log about every few
 * exchanges with a short scene update: time passes, the setting shifts, or
 * something happens that moves the story on. It reads like a Y/n-style chat
 * log, where scene breaks sit between the lines of dialogue.
 *
 * Narration rows are stored as ordinary assistant messages
 * (`character_name: "Narrator"`, `type: "narration"`), so the companion sees
 * them in its history and plays along with the new scene. Therapy sessions
 * never get a narrator.
 */

export const NARRATOR_NAME = "Narrator";
export const NARRATION_TYPE = "narration";
/** Completed user → companion exchanges between two narrator beats. */
export const NARRATOR_EVERY_EXCHANGES = 3;

/** True for a narrator beat, including the group-session opening narration. */
export function isNarratorMessage(message) {
  if (!message || typeof message !== "object") return false;
  if (message.type === NARRATION_TYPE) return true;
  return message.role === "assistant" && message.character_name === NARRATOR_NAME;
}

/**
 * Story mode is on by default for every chat except therapy. A session turns
 * it off with `story_mode: false`.
 */
export function storyModeEnabled(session, { therapy = false } = {}) {
  if (!session || therapy) return false;
  if (session.therapy_mode) return false;
  return session.story_mode !== false;
}

function isRealUserTurn(message) {
  return (
    message?.role === "user" &&
    !message.pending &&
    String(message.content || "").trim().length > 0
  );
}

function isCompanionReply(message) {
  return (
    message?.role === "assistant" &&
    !isNarratorMessage(message) &&
    message.character_name !== "__typing__" &&
    message.type !== "event" &&
    String(message.content || "").trim().length > 0
  );
}

/** Completed exchanges since the last narrator beat (or the start). */
export function exchangesSinceNarration(messages) {
  const list = Array.isArray(messages) ? messages : [];
  let count = 0;
  let sawReply = false;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const message = list[i];
    if (isNarratorMessage(message)) break;
    if (isCompanionReply(message)) sawReply = true;
    else if (isRealUserTurn(message) && sawReply) {
      count += 1;
      sawReply = false;
    }
  }
  return count;
}

/**
 * Whether the narrator should speak now. Call it after a companion reply has
 * been stored; the latest row must be that reply.
 */
export function shouldNarrate(messages, { every = NARRATOR_EVERY_EXCHANGES } = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  if (!isCompanionReply(last)) return false;
  return exchangesSinceNarration(list) >= Math.max(1, every);
}

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** Prompt for one narrator beat. */
export function buildNarratorPrompt({
  messages,
  characterNames = [],
  userName = "",
  openingScene = "",
  allowMature = false,
} = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter(
    (m) => m?.role !== "system" && String(m?.content || "").trim(),
  );
  const userLabel = clip(userName, 40) || "Y/n";
  const transcript = list
    .slice(-12)
    .map((m) => {
      const speaker = m.role === "user" ? userLabel : m.character_name || "Character";
      return `${speaker}: ${clip(m.content, 600)}`;
    })
    .join("\n");
  const cast = characterNames.filter(Boolean).join(", ") || "the companion";
  const scene = clip(openingScene, 400);

  return `You are the NARRATOR of an interactive story told as a chat log between ${userLabel} and ${cast}. You are not a character. Every few messages you step in with a short scene update that moves the story forward.

${scene ? `Story premise: ${scene}\n\n` : ""}Recent chat log:
${transcript}

Write ONE narrator beat:
- 2 to 4 sentences of vivid third-person prose, present tense.
- Move the story forward: let time pass, shift the location or atmosphere, or introduce a small development, discovery, or complication that grows out of what just happened.
- Stay consistent with the setting, tone, and facts already in the log.
- Never write dialogue for anyone, and never decide what ${userLabel} says, feels, or does.
- Do not repeat or summarise the last messages; add something new.
- Leave an opening for the characters to react.${allowMature ? "" : "\n- Keep it non-explicit."}

Return JSON:
- scene: a short scene heading of 2 to 6 words (for example "Later, at the docks"), or "" if the scene has not moved.
- narration: the narrator beat.`;
}

const NARRATION_SCHEMA = {
  type: "object",
  properties: {
    scene: { type: "string" },
    narration: { type: "string" },
  },
  required: ["narration"],
};

export const NARRATOR_RESPONSE_SCHEMA = NARRATION_SCHEMA;

/** Strip stray speaker labels, quotes, and markup from model output. */
export function cleanNarration(text) {
  let value = String(text || "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\[(EMOTION|LOCATION|IMAGE)[^\]]*\]/gi, "")
    .trim();
  value = value.replace(/^\*{0,2}narrator\*{0,2}\s*[:—-]\s*/i, "");
  value = value.replace(/^["“](.*)["”]$/s, "$1").trim();
  return value;
}

/** Turn an InvokeLLM result (object or string) into a narrator message. */
export function narratorMessageFromResult(result, { now = new Date() } = {}) {
  let scene = "";
  let narration = "";
  if (result && typeof result === "object") {
    scene = cleanNarration(result.scene);
    narration = cleanNarration(result.narration || result.content || result.text);
  } else {
    narration = cleanNarration(result);
  }
  if (!narration) return null;
  return {
    role: "assistant",
    type: NARRATION_TYPE,
    character_name: NARRATOR_NAME,
    content: narration.slice(0, 1200),
    ...(scene ? { scene_heading: scene.slice(0, 80) } : {}),
    timestamp: now.toISOString(),
  };
}
