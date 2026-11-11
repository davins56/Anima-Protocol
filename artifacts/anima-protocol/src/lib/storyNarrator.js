/**
 * Story-mode narrator.
 *
 * The Narrator steps into the chat log with a short scene update when the
 * story calls for one, the way a Y/n-style chat log puts scene breaks between
 * lines of dialogue. There is no fixed schedule: after each completed
 * exchange the narrator's "mind" reads the recent log and decides whether
 * this is the right moment. That can be after one exchange (the characters
 * just left for somewhere new) or after ten (a close conversation that should
 * not be interrupted). Ten exchanges without narration makes a beat due.
 *
 * Narration rows are stored as ordinary assistant messages
 * (`character_name: "Narrator"`, `type: "narration"`), so the companion sees
 * them in its history and plays along with the new scene. Therapy sessions
 * never get a narrator.
 */

export const NARRATOR_NAME = "Narrator";
export const NARRATION_TYPE = "narration";
/** After this many exchanges without narration, a beat is due. */
export const NARRATOR_MAX_EXCHANGES = 10;
/** Exchanges before the narrator is consulted when nothing signals a scene change. */
export const NARRATOR_QUIET_EXCHANGES = 2;

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

/** The most recent narrator beat, or null. */
export function lastNarration(messages) {
  const list = Array.isArray(messages) ? messages : [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    if (isNarratorMessage(list[i])) return list[i];
  }
  return null;
}

// Cheap local signals that the scene may be about to move. They only decide
// whether to ask the narrator's mind early; the mind makes the real call.
const SCENE_CUES = [
  ["movement", /\b(let'?s go|come with me|follow me|head(?:ing|ed)? (?:to|out|over|back|home)|we should go|walk(?:s|ed|ing)? (?:to|into|out|toward)|leav(?:e|es|ing)|left the|arriv(?:e|es|ed|ing)|get in the car|drive (?:to|us)|step(?:s|ped)? (?:outside|inside|into)|enter(?:s|ed)? the)\b/i],
  ["time", /\b(later|tomorrow|tonight|next (?:morning|day|week)|the next|hours? (?:later|pass)|that night|by morning|sunrise|sunset|dawn|dusk|meanwhile|after (?:a while|that|dinner|school|work))\b/i],
  ["closure", /\b(good ?night|see you|goodbye|bye for now|talk (?:to you )?later|i should (?:go|sleep|head)|i'?m going to (?:bed|sleep))\b/i],
  ["sleep", /\b(fall(?:s|ing)? asleep|fell asleep|wake(?:s)? up|woke up|go(?:ing)? to sleep)\b/i],
  ["event", /\b(suddenly|out of nowhere|a (?:loud )?(?:knock|crash|scream|explosion|bang)|the door (?:opens|bursts|slams)|someone (?:enters|arrives|appears))\b/i],
];

/** Scene-change signals in the latest exchange (user message + replies). */
export function detectSceneCues(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const recent = [];
  for (let i = list.length - 1; i >= 0 && recent.length < 4; i -= 1) {
    const m = list[i];
    if (isNarratorMessage(m)) break;
    if (isCompanionReply(m) || isRealUserTurn(m)) recent.push(String(m.content || ""));
    if (isRealUserTurn(m)) break;
  }
  const text = recent.join("\n");
  return SCENE_CUES.filter(([, re]) => re.test(text)).map(([name]) => name);
}

/** Signs the conversation has stalled: several short replies in a row. */
export function conversationStalled(messages) {
  const replies = (Array.isArray(messages) ? messages : [])
    .filter((m) => isCompanionReply(m) || isRealUserTurn(m))
    .slice(-4);
  if (replies.length < 4) return false;
  return replies.every((m) => String(m.content || "").trim().length < 60);
}

/**
 * Whether to ask the narrator's mind after this reply, and with what context.
 * Call it after a companion reply has been stored; the latest row must be
 * that reply.
 */
export function narratorConsultation(
  messages,
  { quiet = NARRATOR_QUIET_EXCHANGES, max = NARRATOR_MAX_EXCHANGES } = {},
) {
  const list = Array.isArray(messages) ? messages : [];
  const last = list[list.length - 1];
  const exchanges = exchangesSinceNarration(list);
  const cues = detectSceneCues(list);
  const stalled = conversationStalled(list);
  const due = exchanges >= max;
  const consult =
    isCompanionReply(last) &&
    exchanges >= 1 &&
    (due || cues.length > 0 || stalled || exchanges >= quiet);
  return { consult, exchanges, cues, stalled, due };
}

function clip(text, max) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

const CUE_LABELS = {
  movement: "someone is moving to a new place",
  time: "the log mentions time passing",
  closure: "the conversation is winding down",
  sleep: "someone is falling asleep or waking up",
  event: "something sudden just happened",
};

/** Prompt for the narrator's mind: decide, and write the beat if it fits. */
export function buildNarratorPrompt({
  messages,
  characterNames = [],
  userName = "",
  openingScene = "",
  allowMature = false,
  consultation = null,
} = {}) {
  const list = (Array.isArray(messages) ? messages : []).filter(
    (m) => m?.role !== "system" && String(m?.content || "").trim(),
  );
  const userLabel = clip(userName, 40) || "Y/n";
  const transcript = list
    .slice(-16)
    .map((m) => {
      const speaker = isNarratorMessage(m)
        ? "[NARRATOR]"
        : m.role === "user"
          ? userLabel
          : m.character_name || "Character";
      return `${speaker}: ${clip(m.content, 600)}`;
    })
    .join("\n");
  const cast = characterNames.filter(Boolean).join(", ") || "the companion";
  const scene = clip(openingScene, 400);
  const info = consultation || narratorConsultation(messages);
  const signals = [
    `${info.exchanges} exchange${info.exchanges === 1 ? "" : "s"} since the narrator last spoke.`,
    ...(info.cues || []).map((c) => `Signal: ${CUE_LABELS[c] || c}.`),
    ...(info.stalled ? ["Signal: the last few messages are short; the conversation may be stalling."] : []),
    ...(info.due
      ? ["It has been a long time without narration. Unless this is a tender or intense moment, add a beat now."]
      : []),
  ].join("\n");

  return `You are the NARRATOR of an interactive story told as a chat log between ${userLabel} and ${cast}. You are not a character. You read the log and decide, like a skilled game master, whether this is the right moment for a short scene update. Lines marked [NARRATOR] are your earlier beats.

${scene ? `Story premise: ${scene}\n\n` : ""}Recent chat log:
${transcript}

Pacing notes:
${signals}

First decide whether to speak now.
Speak when:
- the characters move somewhere new, or time passes, and the scene needs setting;
- the conversation has stalled or is going in circles and needs a development;
- a moment ends and the story needs a bridge to what comes next;
- something just happened that the world should react to.
Stay silent when:
- the characters are in the middle of a close, emotional, or intimate exchange;
- a question is waiting for an answer, or a thought is unfinished;
- the scene is flowing well on its own;
- you would only repeat what was just said or what your last beat said.
Silence is often the right choice. Do not speak just because you can.

If you speak, write ONE narrator beat:
- 2 to 4 sentences of vivid third-person prose, present tense.
- Move the story forward: let time pass, shift the location or atmosphere, or introduce a small development that grows out of what just happened.
- Stay consistent with the setting, tone, and facts already in the log.
- Never write dialogue for anyone, and never decide what ${userLabel} says, feels, or does.
- Leave an opening for the characters to react.${allowMature ? "" : "\n- Keep it non-explicit."}

Return JSON:
- narrate: true to speak now, false to stay silent.
- reason: a few words on why.
- scene: when narrating, a short scene heading of 2 to 6 words (for example "Later, at the docks"), or "" if the scene has not moved.
- narration: the narrator beat, or "" when silent.`;
}

export const NARRATOR_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    narrate: { type: "boolean" },
    reason: { type: "string" },
    scene: { type: "string" },
    narration: { type: "string" },
  },
  required: ["narrate"],
};

/** Strip stray speaker labels, quotes, and markup from model output. */
export function cleanNarration(text) {
  let value = String(text || "")
    .replace(/<\/?[a-z][^>]*>/gi, "")
    .replace(/\[(EMOTION|LOCATION|IMAGE)[^\]]*\]/gi, "")
    .trim();
  value = value.replace(/^\[?\*{0,2}narrator\*{0,2}\]?\s*[:—-]\s*/i, "");
  value = value.replace(/^["“](.*)["”]$/s, "$1").trim();
  return value;
}

function decidedToNarrate(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return /^(true|yes|1)$/i.test(value.trim());
  return false;
}

/**
 * Turn an InvokeLLM result into a narrator message, or null when the
 * narrator chose silence (or returned nothing usable).
 */
export function narratorMessageFromResult(result, { now = new Date() } = {}) {
  if (!result || typeof result !== "object") return null;
  if (!decidedToNarrate(result.narrate)) return null;
  const scene = cleanNarration(result.scene);
  const narration = cleanNarration(result.narration || result.content || result.text);
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
