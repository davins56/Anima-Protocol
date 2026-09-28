/**
 * Model Tutor — how a steward teaches their own model from inside the app.
 *
 * A lesson is one correction: the conversation up to a reply, the reply the
 * model gave (rejected), and the reply the steward wanted (chosen), with an
 * optional note saying what went wrong. Lessons queue in Postgres
 * (modelTutorStore.ts); server/trainer.py learns them in the background and
 * publishes the next version of the model (see ownModel.ts).
 *
 * Automatic lessons ("always learning") come from ordinary own-model chat
 * turns: the main Anima model writes the reply it would have given, and the
 * own model learns from that — see buildTeacherMessages.
 *
 * Advice is standing guidance ("ask a follow-up question when I'm sad").
 * The own model is far too small to follow written instructions, so advice
 * is not pasted into its prompt. Instead the main Anima model uses it to
 * draft better replies, and the steward teaches those — advice reaches the
 * weights as examples.
 */

import { createHash, randomUUID } from "node:crypto";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

export const MAX_CONTEXT_MESSAGES = 12;
export const MAX_CONTEXT_CHARS = 2000;
export const MAX_REPLY_CHARS = 4000;
export const MAX_NOTE_CHARS = 1000;
export const MAX_ADVICE_CHARS = 500;
export const MAX_ADVICE_ITEMS = 50;

/** saved = waiting for the trainer; failed lessons are retried a few times. */
export type LessonStatus = "saved" | "learned" | "failed";
export type LessonSource = "manual" | "auto";

export interface LessonTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ModelLesson {
  id: string;
  context: LessonTurn[];
  chosen: string;
  rejected: string | null;
  note: string | null;
  session_id: string | null;
  message_id: string | null;
  part: number | null;
  source_brand: string | null;
  taught_by: string;
  source: LessonSource;
  created_date: string;
  updated_date: string;
  status: LessonStatus;
  attempts: number;
  version: number | null;
  loss_before: number | null;
  loss_after: number | null;
  steps: number | null;
  after_reply: string | null;
  error: string | null;
}

export interface ModelAdvice {
  id: string;
  text: string;
  taught_by: string;
  created_date: string;
}

export class TutorInputError extends Error {}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalText(value: unknown, max: number): string | null {
  const t = text(value);
  return t ? t.slice(0, max) : null;
}

/** Recent turns before the corrected reply, oldest first, tails kept. */
export function normalizeLessonContext(raw: unknown): LessonTurn[] {
  if (!Array.isArray(raw)) return [];
  const turns: LessonTurn[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as { role?: unknown; content?: unknown };
    const role =
      record.role === "user"
        ? "user"
        : record.role === "assistant" || record.role === "anima"
          ? "assistant"
          : null;
    const content = text(record.content);
    if (!role || !content) continue;
    turns.push({
      role,
      content:
        content.length > MAX_CONTEXT_CHARS ? content.slice(-MAX_CONTEXT_CHARS) : content,
    });
  }
  return turns.slice(-MAX_CONTEXT_MESSAGES);
}

/**
 * Re-teaching the same reply refines its lesson instead of stacking a second,
 * conflicting one for the same moment.
 */
export function lessonIdFor(input: {
  sessionId?: string | null;
  messageId?: string | null;
  part?: number | null;
}): string {
  if (!input.messageId) return `lsn_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const key = `${input.sessionId || ""}\n${input.messageId}\n${input.part ?? 0}`;
  return `lsn_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

export interface LessonInput {
  context: LessonTurn[];
  chosen: string;
  rejected: string | null;
  note: string | null;
  session_id: string | null;
  message_id: string | null;
  part: number | null;
  source_brand: string | null;
}

export function parseLessonInput(body: unknown): LessonInput {
  const raw = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const chosen = text(raw.chosen);
  if (!chosen) throw new TutorInputError("Write the reply you wanted before teaching.");
  if (chosen.length > MAX_REPLY_CHARS) {
    throw new TutorInputError(`The better reply is longer than ${MAX_REPLY_CHARS} characters.`);
  }
  const part = Number(raw.part);
  return {
    context: normalizeLessonContext(raw.context),
    chosen,
    rejected: optionalText(raw.rejected, MAX_REPLY_CHARS),
    note: optionalText(raw.note, MAX_NOTE_CHARS),
    session_id: optionalText(raw.session_id, 200),
    message_id: optionalText(raw.message_id, 200),
    part: Number.isInteger(part) && part >= 0 && part < 100 ? part : null,
    source_brand: optionalText(raw.source_brand, 32),
  };
}

export function newLesson(
  input: LessonInput,
  taughtBy: string,
  now = new Date(),
  source: LessonSource = "manual",
): ModelLesson {
  const iso = now.toISOString();
  return {
    id: lessonIdFor({ sessionId: input.session_id, messageId: input.message_id, part: input.part }),
    ...input,
    taught_by: taughtBy,
    source,
    created_date: iso,
    updated_date: iso,
    status: "saved",
    attempts: 0,
    version: null,
    loss_before: null,
    loss_after: null,
    steps: null,
    after_reply: null,
    error: null,
  };
}

// ------------------------------------------------------------------ export

/**
 * JSONL for the offline pipeline: drop the files into data/sft/ and
 * data/prefs/ and rerun phases 2–3 to fold every lesson into a new base.
 * Earlier assistant turns stay context only (`train: false`) — they may be
 * the very mistakes the steward corrected.
 */
export function lessonsToSftJsonl(lessons: ModelLesson[]): string {
  return lessons
    .map((lesson) =>
      JSON.stringify({
        messages: [
          ...lesson.context.map((turn) =>
            turn.role === "assistant"
              ? { role: "anima", content: turn.content, train: false }
              : { role: "user", content: turn.content },
          ),
          { role: "anima", content: lesson.chosen },
        ],
      }),
    )
    .join("\n");
}

export function lessonsToDpoJsonl(lessons: ModelLesson[]): string {
  return lessons
    .filter((lesson) => lesson.rejected && lesson.rejected.trim() !== lesson.chosen.trim())
    .map((lesson) =>
      JSON.stringify({
        prompt_messages: lesson.context.map((turn) => ({
          role: turn.role === "assistant" ? "anima" : "user",
          content: turn.content,
        })),
        chosen: lesson.chosen,
        rejected: lesson.rejected,
      }),
    )
    .join("\n");
}

// ------------------------------------------------------------------ drafting

export const DRAFT_MAX_WORDS = 60;

/**
 * Ask the main Anima model to rewrite a reply the way the steward described.
 * Short on purpose: the own model's whole memory is ~256 tokens.
 */
export function buildDraftMessages(input: {
  context: LessonTurn[];
  rejected: string | null;
  note: string | null;
  advice: string[];
}): ChatCompletionMessageParam[] {
  const guidance = input.advice.filter(Boolean);
  const system = [
    "You are Anima's teaching assistant. The steward is training a very small companion model " +
      "by showing it better replies to learn from.",
    "Rewrite the companion's reply so it follows the steward's guidance. Keep the same voice: " +
      `warm, natural, in character. Keep it under ${DRAFT_MAX_WORDS} words — the student model ` +
      "can only learn short replies.",
    "Answer with the improved reply text only: no preamble, no quotation marks, no notes.",
    guidance.length
      ? `Standing guidance from the steward:\n${guidance.map((a) => `- ${a}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  const transcript = input.context.length
    ? input.context
        .map((turn) => `${turn.role === "user" ? "User" : "Companion"}: ${turn.content}`)
        .join("\n")
    : "(no earlier messages)";
  const user = [
    `Conversation so far:\n${transcript}`,
    `Reply to improve:\n${input.rejected || "(the model gave no reply)"}`,
    `What the steward says went wrong:\n${input.note || "(no note — write a better, more caring reply)"}`,
  ].join("\n\n");
  return [
    { role: "system", content: system },
    { role: "user", content: user },
  ];
}

/** Strip wrappers big models like to add around "just the reply". */
export function cleanDraft(raw: string): string {
  let out = raw.trim();
  out = out.replace(/^(?:improved reply|reply|rewritten reply)\s*:\s*/i, "");
  const quoted = out.match(/^["“](.*)["”]$/s);
  if (quoted) out = quoted[1]!.trim();
  return out.slice(0, MAX_REPLY_CHARS);
}

/**
 * "Always learning": the main Anima model answers the same moment the own
 * model just did, and the own model learns that answer. Given the recent
 * conversation only — the character sheet and memories the main chat prompt
 * carries would not fit in the own model's context anyway, so the lesson
 * teaches what the student can actually see.
 */
export function buildTeacherMessages(input: {
  context: LessonTurn[];
  advice: string[];
}): ChatCompletionMessageParam[] {
  const guidance = input.advice.filter(Boolean);
  const system = [
    "You are Anima, a warm, emotionally present companion. You are writing an example reply " +
      "for a very small companion model to learn from.",
    `Reply to the user's last message in under ${DRAFT_MAX_WORDS} words, naturally and in character. ` +
      "Answer with the reply text only: no preamble, no quotation marks, no notes.",
    guidance.length
      ? `Standing guidance from the steward:\n${guidance.map((a) => `- ${a}`).join("\n")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: system },
    ...input.context.map(
      (turn): ChatCompletionMessageParam =>
        turn.role === "user"
          ? { role: "user", content: turn.content }
          : { role: "assistant", content: turn.content },
    ),
  ];
}
