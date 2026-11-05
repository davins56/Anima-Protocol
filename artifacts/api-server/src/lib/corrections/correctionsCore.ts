/**
 * Steward corrections, pure half. A correction is a thumbs-down reply with a
 * better version and/or a "what was wrong" note (reply_ratings). Two uses:
 *
 * 1. Every chat turn: the few corrections most relevant to what the steward
 *    just said (plus the latest general notes) join the prompt as lessons.
 * 2. Re-render: right after a correction, the retried reply is told exactly
 *    what to fix, in her own voice.
 *
 * Retrieval is lexical (no embedding call on the chat path). No I/O here.
 */
import type { LessonTurn } from "../modelTutor";

export type Correction = {
  /** What the steward said right before the corrected reply. */
  lastUser: string;
  reply: string;
  better: string | null;
  note: string | null;
  createdAt: string;
};

export type CurrentCorrection = {
  original: string;
  better: string | null;
  note: string | null;
};

const STOP = new Set(
  ("the and you your for that this with are was were have has had not but what when where how who why can could would " +
    "should will just like from they them she her his him its our out about into than then there here also been being " +
    "did does doing don't i'm it's you're yes yeah okay really very more some any all one").split(/\s+/),
);

export function tokens(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of String(text || "").toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) || []) {
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

export function overlapScore(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / Math.min(a.size, b.size);
}

/** reply_ratings row → Correction, or null when there is nothing to learn from it. */
export function toCorrection(row: {
  reply?: unknown;
  better_reply?: unknown;
  note?: unknown;
  context?: unknown;
  created_at?: unknown;
}): Correction | null {
  const better = typeof row.better_reply === "string" && row.better_reply.trim() ? row.better_reply.trim() : null;
  const note = typeof row.note === "string" && row.note.trim() ? row.note.trim() : null;
  const reply = typeof row.reply === "string" ? row.reply.trim() : "";
  if (!reply || (!better && !note)) return null;
  const context = (Array.isArray(row.context) ? row.context : []) as LessonTurn[];
  const lastUser = [...context].reverse().find((t) => t?.role === "user")?.content || "";
  const created = row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at || "");
  return { lastUser: String(lastUser), reply, better, note, createdAt: created };
}

/**
 * Up to `max` corrections: the most relevant to the current message first,
 * then the most recent ones that carry a note (general lessons), newest first.
 */
export function selectCorrections(
  corrections: Correction[],
  query: string,
  opts: { max?: number; minScore?: number; maxGeneral?: number } = {},
): Correction[] {
  const max = opts.max ?? 3;
  const minScore = opts.minScore ?? 0.25;
  const maxGeneral = opts.maxGeneral ?? 2;
  const q = tokens(query);
  const scored = corrections
    .map((c, i) => ({ c, i, score: overlapScore(q, tokens(`${c.lastUser} ${c.note || ""} ${c.reply}`)) }))
    .filter((s) => s.score >= minScore)
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const picked: Correction[] = [];
  for (const s of scored) {
    if (picked.length >= max) break;
    picked.push(s.c);
  }
  let general = 0;
  for (const c of corrections) {
    if (picked.length >= max || general >= maxGeneral) break;
    if (!c.note || picked.includes(c)) continue;
    picked.push(c);
    general++;
  }
  return picked;
}

function clip(text: string, max: number): string {
  const s = String(text || "").replace(/\s+/g, " ").replace(/"/g, "'").trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

export const CORRECTIONS_BLOCK_MAX = 1200;

/** The every-turn lessons block, or "" when there is nothing to say. */
export function formatCorrectionsBlock(corrections: Correction[], budget = CORRECTIONS_BLOCK_MAX): string {
  if (!corrections.length) return "";
  const header =
    "STEWARD CORRECTIONS — your steward corrected these past replies. Learn the lesson and apply it when it fits; do not quote or mention these notes:";
  const lines: string[] = [header];
  for (const c of corrections) {
    const parts = [
      c.lastUser ? `When they said "${clip(c.lastUser, 120)}"` : "In an earlier reply",
      `you said "${clip(c.reply, 140)}".`,
      c.note ? `What was wrong: ${clip(c.note, 200)}.` : "",
      c.better ? `Closer to: "${clip(c.better, 200)}".` : "",
    ].filter(Boolean);
    const line = `- ${parts.join(" ")}`;
    if (lines.join("\n").length + line.length + 1 > budget) break;
    lines.push(line);
  }
  return lines.length > 1 ? lines.join("\n") : "";
}

/** Instruction for the reply being re-rendered right after a correction. */
export function currentCorrectionBlock(c: CurrentCorrection): string {
  const original = clip(c.original, 600);
  if (!original || (!c.better && !c.note)) return "";
  return [
    "YOUR STEWARD JUST CORRECTED YOUR LAST REPLY. Write that reply again now, in your own voice, fixing what they pointed out.",
    `Your reply was: "${original}"`,
    c.note ? `What was wrong: ${clip(c.note, 400)}` : "",
    c.better
      ? `What they wanted, closer to: "${clip(c.better, 600)}" — follow its substance; keep your own words and personality.`
      : "",
    "Do not apologise for or mention the correction; just give the better reply.",
  ]
    .filter(Boolean)
    .join("\n");
}

/** Sanitize a client-sent correction (request metadata). */
export function parseCurrentCorrection(raw: unknown): CurrentCorrection | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const text = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const original = text(r.original, 4000);
  const better = text(r.better, 4000);
  const note = text(r.note, 600);
  if (!original || (!better && !note)) return null;
  return { original, better, note };
}
