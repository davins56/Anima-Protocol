// Model Tutor — client helpers for teaching the steward's own model.
// The API is steward-only (see artifacts/api-server/src/routes/modelTutor.ts).

/** Earlier turns sent with a lesson. The model only sees ~256 tokens anyway. */
export const TEACH_CONTEXT_TURNS = 12;

/** Replies longer than this rarely fit the own model's memory whole. */
export const LONG_REPLY_CHARS = 600;

function isHiddenSpeaker(message) {
  const name = message?.character_name;
  return name === "__typing__" || name === "__thinking__";
}

/**
 * The conversation before `index`, as user/assistant turns — what the model
 * saw when it gave the reply being corrected.
 * @param {Array<object>} messages
 * @param {number} index
 */
export function teachableContext(messages, index) {
  const turns = [];
  for (const message of (messages || []).slice(0, Math.max(index, 0))) {
    if (!message || message.type === "event" || isHiddenSpeaker(message)) continue;
    const role =
      message.role === "user" ? "user" : message.role === "assistant" ? "assistant" : null;
    const content = typeof message.content === "string" ? message.content.trim() : "";
    if (!role || !content) continue;
    turns.push({ role, content });
  }
  return turns.slice(-TEACH_CONTEXT_TURNS);
}

/**
 * Everything the Teach dialog needs about one assistant reply.
 * `subMessage` / `part` identify one speaker inside a split group reply.
 */
export function buildTeachTarget({ session, messages, index, subMessage = null, part = null }) {
  const message = subMessage || messages?.[index];
  if (!message || message.role !== "assistant" || isHiddenSpeaker(message)) return null;
  return {
    session_id: session?.id || null,
    message_id: messages?.[index]?.id || null,
    part: Number.isInteger(part) ? part : null,
    context: teachableContext(messages, index),
    rejected: String(message.content || "").trim(),
    // Split group replies are rebuilt per speaker; the brand stays on the parent.
    source_brand: message.llm_brand || messages?.[index]?.llm_brand || null,
    character_name: message.character_name || null,
  };
}

/** True when the reply came from the steward's own model. */
export function isOwnModelReply(message) {
  return message?.llm_brand === "own";
}

export function lessonStatusLabel(lesson) {
  switch (lesson?.status) {
    case "learned":
      return "Learned";
    case "learning":
      return "Learning…";
    case "failed":
      return "Didn't take";
    default:
      return "Waiting to learn";
  }
}

/**
 * The server reports loss in nats per token; exp(-loss) is how likely the
 * model found each word of the reply, which reads better than a loss.
 * @param {number | null | undefined} loss
 */
export function wordChancePercent(loss) {
  if (typeof loss !== "number" || !Number.isFinite(loss)) return null;
  const pct = Math.exp(-loss) * 100;
  if (pct >= 10) return Math.round(pct);
  if (pct >= 1) return Math.round(pct * 10) / 10;
  return Math.max(Math.round(pct * 100) / 100, 0.01);
}

/** "1% → 73% per word" once a lesson has been learned, else null. */
export function describeLearning(lesson) {
  const before = wordChancePercent(lesson?.loss_before);
  const after = wordChancePercent(lesson?.loss_after);
  if (before == null || after == null) return null;
  return `${before}% → ${after}% per word`;
}

/** Poll a learning job until it settles (or we give up waiting). */
export async function waitForLesson(api, lesson, { intervalMs = 2000, timeoutMs = 180_000, sleep } = {}) {
  const pause = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  let current = lesson;
  const deadline = Date.now() + timeoutMs;
  while (current?.status === "learning" && current.job_id && Date.now() < deadline) {
    await pause(intervalMs);
    const polled = await api.job(current.job_id, { lessonId: current.id });
    if (polled?.lesson) current = polled.lesson;
    else if (polled?.job?.status === "failed") {
      current = { ...current, status: "failed", error: polled.job.error || "Learning failed" };
    }
  }
  return current;
}

/** Save text as a file (lesson exports for the offline training pipeline). */
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/x-ndjson" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
