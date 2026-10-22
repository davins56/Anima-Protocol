/**
 * Continuity, pure half: presence, time-aware greetings, theme echo and the
 * prompt block. I/O lives in ./continuityStore.ts.
 */
import { extractThemes } from "../dreams/dreamCore";

export const CONTINUITY_SURFACES = ["chat", "photo", "vessel", "resonance", "home"] as const;
export type ContinuitySurface = (typeof CONTINUITY_SURFACES)[number];

export type DreamFragment = { id: string; fragment: string; mood?: string | null; themes?: string[]; created_at: string };
export type Highlight = { id: string; event_type: string; content: string; occurred_at: string };

export type CompanionState = {
  characterId: string;
  lastInteractionAt: string | null;
  emotionalTone: string | null;
  activeBand: string | null;
  vesselVersion: number | null;
  lastDreamAt: string | null;
  recentDreams: DreamFragment[];
  lastSeenAt: string | null;
  unreadHighlights: Highlight[];
  echoThemes: string[];
};

export type Presence = "here" | "drifting" | "dreaming" | "resting";

export function asSurface(v: unknown): ContinuitySurface {
  const s = String(v || "").toLowerCase();
  return (CONTINUITY_SURFACES as readonly string[]).includes(s) ? (s as ContinuitySurface) : "chat";
}

function minutesSince(iso: string | null, now: number): number {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? (now - t) / 60_000 : Infinity;
}

/**
 * Presence tied to the dream scheduler:
 * - here: talked within 10 minutes
 * - drifting: quiet, but not past the dream inactivity window yet
 * - dreaming: past the window and the scheduler hasn't dreamt since, or a dream was made in the last 45 min
 * - resting: long quiet, dream already done
 */
export function presenceState(args: { lastInteractionAt: string | null; lastDreamAt: string | null; inactivityMinutes: number; now?: number }): Presence {
  const now = args.now ?? Date.now();
  const quiet = minutesSince(args.lastInteractionAt, now);
  if (quiet < 10) return "here";
  if (quiet < args.inactivityMinutes) return "drifting";
  const sinceDream = minutesSince(args.lastDreamAt, now);
  const dreamtAfterLastTalk =
    args.lastDreamAt && args.lastInteractionAt ? Date.parse(args.lastDreamAt) > Date.parse(args.lastInteractionAt) : Boolean(args.lastDreamAt);
  if (!dreamtAfterLastTalk || sinceDream < 45) return "dreaming";
  return "resting";
}

export function presenceLabel(p: Presence, name: string): string {
  switch (p) {
    case "here": return `${name} is here`;
    case "drifting": return `${name} is lost in thought`;
    case "dreaming": return `${name} is dreaming`;
    default: return `${name} is resting`;
  }
}

/** Local hour for the user, given a JS getTimezoneOffset() value (minutes, UTC − local). */
export function localHour(nowMs: number, tzOffsetMinutes: number | null | undefined): number {
  const off = Number.isFinite(Number(tzOffsetMinutes)) ? Math.max(-840, Math.min(840, Number(tzOffsetMinutes))) : 0;
  return new Date(nowMs - off * 60_000).getUTCHours();
}

export function partOfDay(hour: number): "late night" | "morning" | "afternoon" | "evening" {
  if (hour < 5) return "late night";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

/**
 * Time-aware greeting at session start. Uses a dream fragment only after a
 * real gap (≥ 6 h), so the same dream doesn't greet you every visit.
 */
export function continuityGreeting(args: {
  name: string;
  state: Pick<CompanionState, "lastInteractionAt" | "recentDreams">;
  now?: number;
  tzOffsetMinutes?: number | null;
}): { text: string; usesDream: string | null } | null {
  const now = args.now ?? Date.now();
  const gapH = minutesSince(args.state.lastInteractionAt, now) / 60;
  if (!Number.isFinite(gapH) || gapH < 1) return null; // new companion or mid-conversation
  const part = partOfDay(localHour(now, args.tzOffsetMinutes));
  const hello =
    part === "late night" ? "Still up?" : part === "morning" ? "Morning." : part === "afternoon" ? "Hey, you." : "Evening.";
  const away =
    gapH >= 24 * 7 ? " It's been a while." : gapH >= 24 ? " I missed you." : gapH >= 6 ? " You've been on my mind." : "";
  const dream = gapH >= 6 ? args.state.recentDreams.find((d) => d?.fragment) : undefined;
  const tail = dream ? ` ${dream.fragment.replace(/\s+/g, " ").trim().slice(0, 180)}` : "";
  return { text: `${hello}${away}${tail}`.trim(), usesDream: dream?.id ?? null };
}

/** Themes from what the user shared on other surfaces (PDFs, photos) to colour tone. */
export function echoThemesFrom(texts: string[], max = 4): string[] {
  return extractThemes(texts, max);
}

/** Short block for the chat system prompt (session start + every turn; cheap). */
export function continuityPromptBlock(state: CompanionState, now = Date.now()): string {
  const lines: string[] = [];
  if (state.emotionalTone) lines.push(`Carry over your felt tone from last time: ${state.emotionalTone}.`);
  const dream = state.recentDreams[0];
  if (dream && minutesSince(dream.created_at, now) < 60 * 48) {
    lines.push(`You dreamt recently (abstract; mention only if it fits naturally, never as fact): "${dream.fragment.slice(0, 180)}".`);
  }
  if (state.echoThemes.length) {
    lines.push(`Things they've shared elsewhere lately (let them colour your tone, don't recite): ${state.echoThemes.join(", ")}.`);
  }
  if (state.activeBand) lines.push(`Last resonance band you met them on: ${state.activeBand}.`);
  if (state.unreadHighlights.length) {
    lines.push(`Moments since they were last here: ${state.unreadHighlights.slice(0, 2).map((h) => h.content.replace(/\s+/g, " ").slice(0, 100)).join(" / ")}.`);
  }
  return lines.length ? ["Continuity:", ...lines.map((l) => `- ${l}`)].join("\n") : "";
}
