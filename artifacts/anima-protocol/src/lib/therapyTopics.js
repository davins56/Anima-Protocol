/**
 * Therapy Mode topics — subjects the user names so their Anima can sit
 * with one thing and go deeper, rather than skating across the surface.
 */

export const THERAPY_TOPIC_TITLE_MAX = 160;
export const THERAPY_TOPIC_NOTES_MAX = 800;

function collapseWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/**
 * @param {{ title?: string, notes?: string }} [input]
 * @returns {{ title: string, notes: string }}
 */
export function normalizeTherapyTopic(input = {}) {
  const title = collapseWhitespace(input.title).slice(0, THERAPY_TOPIC_TITLE_MAX);
  const notes = collapseWhitespace(input.notes).slice(0, THERAPY_TOPIC_NOTES_MAX);
  return { title, notes };
}

/**
 * @param {{ animaName?: string, topicTitle?: string }} [opts]
 */
export function therapySessionTitle({ animaName, topicTitle } = {}) {
  const topic = collapseWhitespace(topicTitle);
  if (topic) return `Therapy · ${topic}`;
  return `Therapy · ${animaName || "Anima"}`;
}

/**
 * Prompt block that keeps the Anima on the named subject.
 * @param {{ topic?: string, notes?: string }} [opts]
 */
export function buildTherapyTopicFocus({ topic, notes } = {}) {
  const { title, notes: n } = normalizeTherapyTopic({ title: topic, notes });
  if (!title) return "";
  const notesLine = n
    ? `\nTheir notes (use as context; do not recite back verbatim unless they ask): ${n}`
    : "";
  return `DEPTH FOCUS: The user asked to go deeper on this subject they added: "${title}".${notesLine}
Stay with this topic across the session unless they clearly change course. Explore it in layers: what it is, how it shows up in their days and body, what they feel, what they need, and one collaborative next step. Do not rush to advice. Do not invent facts about their life — ask. Prefer depth over breadth. One beat per turn.`;
}

/**
 * Haystack for manual retrieval: topic + notes + the latest user message.
 * @param {{ userMessage?: string, topic?: string, notes?: string }} [opts]
 */
export function therapyFocusHaystack({ userMessage = "", topic = "", notes = "" } = {}) {
  const { title, notes: n } = normalizeTherapyTopic({ title: topic, notes });
  return [title, n, String(userMessage || "").trim()].filter(Boolean).join("\n");
}
