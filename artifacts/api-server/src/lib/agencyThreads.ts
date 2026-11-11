/**
 * Agency Engine, first slice (ANIMA_KERNEL_AGENCY, default off): thread-based
 * proactive follow-ups. When the user mentioned something coming up
 * ("my recital is on Friday", "interview tomorrow"), the next proactive
 * check-in after it was due asks how it went, instead of a generic hello.
 *
 * Pure and heuristic: no model call, no new storage. Threads are read from
 * the same recent messages the proactive pipeline already loads.
 */
import type { MsgData } from "./promptBuilder";

const DAY_MS = 86_400_000;
const FOLLOW_UP_WINDOW_MS = 7 * DAY_MS;

const EVENT_WORDS = [
  "interview", "exam", "test", "recital", "concert", "appointment", "date", "trip", "flight",
  "surgery", "operation", "meeting", "presentation", "audition", "deadline", "doctor", "dentist",
  "therapy", "game", "match", "race", "party", "wedding", "funeral", "move", "moving", "first day",
  "results", "review", "call", "hearing",
];
const EVENT_RE = new RegExp(`\\b(${EVENT_WORDS.map((w) => w.replace(/ /g, "\\s+")).join("|")})\\b`, "i");
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export type OpenThread = {
  topic: string;
  eventWord: string;
  mentionedAt: number;
  dueAt: number;
};

/** ms offset from the mention to when the thing has happened, or null. */
export function cueDueAt(text: string, mentionedAt: number): number | null {
  const t = text.toLowerCase();
  const at = new Date(mentionedAt);
  const startOfDay = Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
  if (/\btonight\b|\bthis evening\b|\blater today\b/.test(t)) return startOfDay + DAY_MS + 9 * 3_600_000;
  if (/\btomorrow\b/.test(t)) return startOfDay + 2 * DAY_MS + 9 * 3_600_000;
  const inDays = /\bin (\d{1,2}) days?\b/.exec(t);
  if (inDays) return startOfDay + (Number(inDays[1]) + 1) * DAY_MS + 9 * 3_600_000;
  if (/\bnext week\b/.test(t)) return startOfDay + 8 * DAY_MS;
  if (/\bthis weekend\b|\bon the weekend\b|\bthe weekend\b/.test(t)) {
    const toMonday = ((1 - at.getUTCDay() + 7) % 7) || 7;
    return startOfDay + toMonday * DAY_MS + 9 * 3_600_000;
  }
  for (let i = 0; i < 7; i += 1) {
    if (new RegExp(`\\b(on |this |next )?${WEEKDAYS[i]}\\b`).test(t)) {
      const ahead = ((i - at.getUTCDay() + 7) % 7) || 7;
      return startOfDay + (ahead + 1) * DAY_MS + 9 * 3_600_000;
    }
  }
  return null;
}

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

function ts(m: MsgData): number {
  const n = Date.parse(String(m.timestamp || ""));
  return Number.isFinite(n) ? n : 0;
}

/** Upcoming things the user mentioned that nobody has followed up on yet. */
export function extractOpenThreads(messages: MsgData[]): OpenThread[] {
  const threads: OpenThread[] = [];
  messages.forEach((m, idx) => {
    if (m.role !== "user") return;
    const when = ts(m);
    if (!when) return;
    for (const s of sentences(String(m.content || ""))) {
      const ev = EVENT_RE.exec(s);
      if (!ev) continue;
      const dueAt = cueDueAt(s, when);
      if (dueAt == null) continue;
      const word = ev[1].toLowerCase().replace(/\s+/g, " ");
      // Closed if any later message (either side) talks about it again after it was due.
      const later = messages.slice(idx + 1);
      const closed = later.some(
        (x) => ts(x) >= dueAt && new RegExp(`\\b${word.replace(/ /g, "\\s+")}\\b`, "i").test(String(x.content || "")),
      );
      if (closed) continue;
      threads.push({ topic: s.slice(0, 160), eventWord: word, mentionedAt: when, dueAt });
    }
  });
  return threads;
}

/** The thread to follow up on now: due, not stale; earliest due first. */
export function dueThread(threads: OpenThread[], now = Date.now()): OpenThread | null {
  return (
    threads
      .filter((t) => t.dueAt <= now && now - t.dueAt <= FOLLOW_UP_WINDOW_MS)
      .sort((a, b) => a.dueAt - b.dueAt)[0] ?? null
  );
}

export function threadFollowUpInstruction(thread: OpenThread): string {
  return (
    "Send one warm, natural follow-up as this character about something the user told you was coming up: " +
    `"${thread.topic.replace(/"/g, "'")}". Ask how the ${thread.eventWord} went, in your own voice. ` +
    "Don't invent how it went or claim details you don't know. " +
    "Do not mention apps, notifications, inactivity, schedules, or being an AI. " +
    "Do not guilt, pressure, alarm, sexualize, or manipulate the user. " +
    "Keep it safe for a lock-screen preview, in character, and at most two short sentences."
  );
}
