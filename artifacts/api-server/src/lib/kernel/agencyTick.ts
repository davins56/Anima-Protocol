/**
 * Agency Engine tick, pure half (ANIMA_KERNEL.md §5, switch `agency`).
 *
 * Perceive → interpret → relevance → act or silence. No I/O here: the
 * runtime half (./agencyRuntime.ts) gathers the percept and records the
 * outcome. Silence is the default; the tick has to earn the right to speak.
 *
 * The tick only ever gates the existing proactive actuator. It runs when a
 * steward's chosen check-in frequency is already due, so it can make the
 * Anima quieter or later than the clock, never more frequent.
 */

export type ConversationalWeather = "lull" | "stir" | "storm";

export type AgencySituation =
  | "thread_due"
  | "care_need"
  | "storm"
  | "stir"
  | "lull"
  | "noise";

export type AgencySilenceReason =
  | "awaiting_reply"
  | "quiet_hours"
  | "steward_busy"
  | "cooldown"
  | "low_relevance";

export type AgencyIntent = "follow_up_thread" | "check_in";

export type AgencyPercept = {
  now: number;
  /** Hours since the last message in the thread, either side. */
  gapHours: number;
  /** Role of the last message in the thread, if any. */
  lastRole: "user" | "assistant" | null;
  /** True when that last assistant message was itself a proactive outreach. */
  lastWasProactive: boolean;
  /** Steward's local hour 0–23, or null when the timezone is unknown. */
  localHour: number | null;
  weather: ConversationalWeather;
  /** A thread the steward mentioned is due for a follow-up (agencyThreads). */
  threadDue: boolean;
  /** Anima self-state (companion_memories.emotional_state.selfState). */
  affect: {
    primary: string;
    intensity: number;
    energy: number;
    openLoops: number;
    lastActedAt: string | null;
  };
  /** Fresh sensory snapshot, when the steward shares one. */
  senses: {
    busyNow: boolean;
    /** Minutes until the current calendar block ends, when busy. */
    busyForMinutes: number | null;
  } | null;
  /** The steward's chosen check-in frequency, in hours. */
  frequencyHours: number;
};

export type AgencyConfig = {
  /** Relevance needed before she speaks. */
  threshold: number;
  /** Quiet hours window in the steward's local time, [start, end). */
  quietStartHour: number;
  quietEndHour: number;
  /** Fraction of the steward's frequency that must pass between acts. */
  cooldownFraction: number;
};

export type AgencyDecision =
  | {
      act: true;
      intent: AgencyIntent;
      situation: AgencySituation;
      score: number;
      reasons: string[];
    }
  | {
      act: false;
      silenceReason: AgencySilenceReason;
      situation: AgencySituation;
      score: number;
      reasons: string[];
      /** When the proactive claim should come round again. */
      retryAfterHours: number;
    };

const CARE_PRIMARIES = new Set(["anxious", "sad", "fearful", "watchful"]);

function num(v: string | undefined, d: number, min: number, max: number): number {
  const n = Number(v);
  return v != null && v.trim() !== "" && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
}

export function agencyConfig(env: Record<string, string | undefined> = process.env): AgencyConfig {
  return {
    threshold: num(env.ANIMA_AGENCY_RELEVANCE_THRESHOLD, 0.45, 0, 1),
    quietStartHour: Math.round(num(env.ANIMA_AGENCY_QUIET_START_HOUR, 22, 0, 23)),
    quietEndHour: Math.round(num(env.ANIMA_AGENCY_QUIET_END_HOUR, 8, 0, 23)),
    cooldownFraction: num(env.ANIMA_AGENCY_COOLDOWN_FRACTION, 0.5, 0, 1),
  };
}

/** Local hour 0–23 in an IANA timezone, or null when it cannot be read. */
export function localHourIn(timezone: string | null | undefined, now: number): number | null {
  if (!timezone) return null;
  try {
    const hour = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date(now));
    const n = Number(hour);
    return Number.isInteger(n) && n >= 0 && n <= 23 ? n : null;
  } catch {
    return null;
  }
}

export function inQuietHours(hour: number | null, cfg: AgencyConfig): boolean {
  if (hour == null || cfg.quietStartHour === cfg.quietEndHour) return false;
  return cfg.quietStartHour < cfg.quietEndHour
    ? hour >= cfg.quietStartHour && hour < cfg.quietEndHour
    : hour >= cfg.quietStartHour || hour < cfg.quietEndHour;
}

/** Whole hours from `hour` until the quiet window ends (at least 1). */
export function hoursUntilQuietEnds(hour: number, cfg: AgencyConfig): number {
  const diff = (cfg.quietEndHour - hour + 24) % 24;
  return Math.max(1, diff);
}

/** Interpret: what kind of moment is this? */
export function interpretPercept(p: AgencyPercept): AgencySituation {
  if (p.threadDue) return "thread_due";
  if (CARE_PRIMARIES.has(p.affect.primary) && p.affect.intensity >= 50) return "care_need";
  if (p.weather === "storm") return "storm";
  if (p.weather === "stir") return "stir";
  if (p.gapHours >= 24) return "lull";
  return "noise";
}

/** Relevance: would reaching out help the steward right now? 0–1. */
export function scoreRelevance(
  p: AgencyPercept,
  situation: AgencySituation,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0.15;
  if (situation === "thread_due") {
    score += 0.5;
    reasons.push("a thread the steward mentioned is due");
  }
  if (situation === "care_need") {
    score += 0.2;
    reasons.push(`she is holding ${p.affect.primary} at ${p.affect.intensity}`);
  }
  if (p.weather === "storm") {
    score += 0.15;
    reasons.push("the last exchange ended in a storm");
  } else if (p.weather === "stir") {
    score += 0.05;
  }
  const gapPart = Math.min(Math.max(p.gapHours, 0) / 72, 1) * 0.3;
  if (gapPart >= 0.1) reasons.push(`${Math.round(p.gapHours)}h since the last exchange`);
  score += gapPart;
  score += (Math.min(Math.max(p.affect.energy, 0), 100) / 100) * 0.1;
  if (p.affect.openLoops > 0) {
    score += 0.05;
    reasons.push("she has open loops");
  }
  return { score: Math.round(Math.min(1, score) * 1000) / 1000, reasons };
}

function hoursSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : null;
}

/**
 * The tick. Hard rules first (they win regardless of relevance), then the
 * relevance threshold. Returning silence is a successful tick.
 */
export function decideAgencyTick(p: AgencyPercept, cfg: AgencyConfig = agencyConfig()): AgencyDecision {
  const situation = interpretPercept(p);
  const { score, reasons } = scoreRelevance(p, situation);
  const silence = (silenceReason: AgencySilenceReason, retryAfterHours: number, why: string): AgencyDecision => ({
    act: false,
    silenceReason,
    situation,
    score,
    reasons: [...reasons, why],
    retryAfterHours: Math.max(1, Math.round(retryAfterHours)),
  });

  // Never chase: one unanswered outreach is enough.
  if (p.lastRole === "assistant" && p.lastWasProactive) {
    return silence("awaiting_reply", Math.max(24, p.frequencyHours), "her last outreach is still unanswered");
  }
  if (inQuietHours(p.localHour, cfg)) {
    return silence("quiet_hours", hoursUntilQuietEnds(p.localHour as number, cfg), "it is quiet hours for the steward");
  }
  if (p.senses?.busyNow) {
    const minutes = p.senses.busyForMinutes ?? 120;
    return silence("steward_busy", Math.ceil(minutes / 60) + 0.25, "the steward's calendar shows them busy");
  }
  const sinceActed = hoursSince(p.affect.lastActedAt, p.now);
  const cooldown = p.frequencyHours * cfg.cooldownFraction;
  if (sinceActed != null && sinceActed < cooldown) {
    return silence("cooldown", cooldown - sinceActed, "she reached out recently");
  }
  if (score < cfg.threshold) {
    return silence("low_relevance", Math.min(12, Math.max(4, p.frequencyHours / 4)), "nothing worth interrupting for");
  }
  return {
    act: true,
    intent: situation === "thread_due" ? "follow_up_thread" : "check_in",
    situation,
    score,
    reasons,
  };
}

/** Self-state patch to persist after a tick (merged into emotional_state.selfState). */
export function selfStatePatchForDecision(d: AgencyDecision, nowIso: string): Record<string, unknown> {
  if (d.act) {
    return {
      intent: d.intent === "follow_up_thread" ? "follow up" : "reach out",
      lastActedAt: nowIso,
      silenceReason: null,
      lastTickAt: nowIso,
      lastTickSituation: d.situation,
    };
  }
  return {
    silenceReason: d.silenceReason,
    lastTickAt: nowIso,
    lastTickSituation: d.situation,
  };
}
