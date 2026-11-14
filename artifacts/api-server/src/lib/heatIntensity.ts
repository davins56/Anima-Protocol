/**
 * Heat meter, conversational half ("right-now intensity").
 *
 * The intimacy engine (intimacyEngine.ts) only moves `heat` for adult-gated
 * sensual escalation, so a heated argument or a passionate, emotional exchange
 * left the meter at "Calm · 0". This module scores how intense the moment is
 * from the words themselves and cools it on pauses. It is stored separately as
 * `profile.intensity` and shown as max(heat, intensity); it never feeds the
 * adult scene phases, the prompt's intimacy block, or any gate.
 *
 * Pure and deterministic (cooling is counted in whole minutes).
 */
import { containsPhrase } from "./intimacyEngine";
import { scoreUserSynchroDelta } from "./synchroEngine";
import type { IntimacyPace, IntimacyProfile } from "./intimacyTypes";

/** Pulse pace already scales sensual heat this way (intimacyEngine.ts). */
export const PACE_MULTIPLIER: Record<IntimacyPace, number> = { slow: 1, build: 1.4, intense: 2 };
/** Intensity halves for every this many minutes of quiet. */
export const INTENSITY_HALF_LIFE_MINUTES = 6;
/** Most one user message can add before the pace multiplier. */
export const MAX_TURN_GAIN = 25;
/** What the reply can add on top (half its own score, capped). */
export const MAX_REPLY_GAIN = 8;
/** A calm turn takes this much off. */
export const CALM_TURN_COOLING = 4;
/** Back-and-forth faster than this reads as a rapid exchange. */
export const RAPID_EXCHANGE_MS = 90_000;
/** Typing the safeword cools the moment to at most this. */
export const SAFEWORD_CEILING = 15;

const STRONG_EMOTION_RE =
  /\b(furious|livid|enraged|rage|angry|so mad|hate (you|this|that|it)|i hate|scream\w*|yell\w*|desperate|terrified|devastated|sobbing|crying|can'?t stand|heart (is )?(pounding|racing)|shaking|trembling|i swear|love you so|losing my mind)\b/i;
const CONFLICT_RE =
  /\b(argu\w*|fight\w*|liar|lying|lied to me|how dare|how could you|you always|you never|unbelievable|don'?t you dare|back off|stop it|shut up|are you kidding|what the hell|seriously\?)\b/i;
const PASSION_RE =
  /\b(passion\w*|burning|on fire|intense|intensely|can'?t stop thinking|need you|want you so|crav\w*|ache for|aching for|obsessed|all i want|can'?t breathe)\b/i;
/** Flirtation only counts where the adult gate already allows it. */
const FLIRT_RE =
  /\b(flirt\w*|blush\w*|sexy|gorgeous|tempt\w*|breathless|come here|closer)\b/i;

export interface HeatIntensityScore {
  gain: number;
  signals: string[];
}

function exclamationGain(raw: string): number {
  const bangs = (raw.match(/!/g) || []).length;
  if (bangs >= 4) return 7;
  if (bangs >= 2) return 5;
  return bangs === 1 ? 3 : 0;
}

function shouting(raw: string): boolean {
  const words: string[] = raw.match(/\b[A-Za-z]{2,}\b/g) ?? [];
  if (words.length === 0) return false;
  const caps = words.filter((w) => w === w.toUpperCase() && w !== "OK" && w !== "OKAY");
  return caps.length >= 2 && caps.length / words.length >= 0.25;
}

/**
 * How much this message heats the moment (before the pace multiplier).
 * `adult` must be the server adult-gate decision; flirtation is ignored
 * without it.
 */
export function scoreHeatIntensity(
  text: string,
  options: { adult?: boolean; sinceLastTurnMs?: number | null } = {},
): HeatIntensityScore {
  const raw = String(text || "").trim();
  const signals: string[] = [];
  if (!raw) return { gain: 0, signals };
  let gain = 0;
  const add = (name: string, amount: number) => {
    if (amount <= 0) return;
    gain += amount;
    signals.push(name);
  };

  add("exclamation", exclamationGain(raw));
  if (shouting(raw)) add("caps", 6);
  if (STRONG_EMOTION_RE.test(raw)) add("strong-emotion", 8);
  if (CONFLICT_RE.test(raw)) add("conflict", 8);
  if (PASSION_RE.test(raw)) add("passion", 7);
  if (options.adult === true && FLIRT_RE.test(raw)) add("flirt", 5);

  // The same reading of the turn the Synchro meter uses (#722).
  const synchro = scoreUserSynchroDelta(raw, 40).signals;
  if (synchro.includes("hostile") && !signals.includes("conflict")) add("hostile", 6);
  if (synchro.includes("vulnerability")) add("vulnerability", 3);

  if (gain > 0 && raw.length > 280) add("long", 2);
  const since = options.sinceLastTurnMs;
  if (typeof since === "number" && since >= 0 && since < RAPID_EXCHANGE_MS && (gain > 0 || /[!?]/.test(raw))) {
    add("rapid", 3);
  }
  return { gain: Math.min(gain, MAX_TURN_GAIN), signals };
}

/** Pause cooling: halves every INTENSITY_HALF_LIFE_MINUTES, whole minutes only. */
export function coolIntensity(value: number, idleMinutes: number): number {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const minutes = Math.floor(Math.max(0, idleMinutes));
  if (minutes <= 0 || v <= 0) return Math.round(v);
  const cooled = v * Math.pow(0.5, minutes / INTENSITY_HALF_LIFE_MINUTES);
  return cooled < 1 ? 0 : Math.round(cooled);
}

/** Intensity as of `now`, cooled from when it was last set. */
export function currentIntensity(profile: Pick<IntimacyProfile, "intensity" | "intensityAt">, now = Date.now()): number {
  const value = Number(profile.intensity) || 0;
  const at = profile.intensityAt ? Date.parse(profile.intensityAt) : NaN;
  if (!Number.isFinite(at)) return Math.round(Math.max(0, Math.min(100, value)));
  return coolIntensity(value, (now - at) / 60_000);
}

/** What the Heat meter shows: sensual heat or right-now intensity, whichever is higher. */
export function displayHeat(profile: Pick<IntimacyProfile, "heat" | "intensity" | "intensityAt">, now = Date.now()): number {
  const heat = Math.max(0, Math.min(100, Math.round(Number(profile.heat) || 0)));
  return Math.max(heat, currentIntensity(profile, now));
}

/**
 * One turn of right-now intensity: cool for the pause since the last turn,
 * then add this exchange (user message, plus a little from the reply), scaled
 * by the Pulse pace. Only for a profile with Pulse on.
 */
export function evolvePulseIntensity(
  profile: IntimacyProfile,
  args: { userText: string; replyText?: string; adult?: boolean; now?: number },
): IntimacyProfile {
  if (!profile.intimacyEnabled) return profile;
  const now = args.now ?? Date.now();
  const lastAt = profile.intensityAt ? Date.parse(profile.intensityAt) : NaN;
  const sinceLastTurnMs = Number.isFinite(lastAt) ? now - lastAt : null;
  let value = currentIntensity(profile, now);

  const userText = String(args.userText || "");
  const safeword = (profile.safeword || "red").trim().toLowerCase();
  if (safeword && containsPhrase(userText.toLowerCase(), safeword)) {
    value = Math.min(value, SAFEWORD_CEILING);
    return { ...profile, intensity: value, intensityAt: new Date(now).toISOString() };
  }

  const user = scoreHeatIntensity(userText, { adult: args.adult, sinceLastTurnMs });
  const reply = scoreHeatIntensity(String(args.replyText || ""), { adult: args.adult });
  const multiplier = PACE_MULTIPLIER[profile.preferredPace] ?? 1;
  const replyGain = Math.min(MAX_REPLY_GAIN, Math.round(reply.gain / 2));
  const gain = Math.round((user.gain + replyGain) * multiplier);
  value = gain > 0 ? value + gain : value - CALM_TURN_COOLING;
  return {
    ...profile,
    intensity: Math.max(0, Math.min(100, value)),
    intensityAt: new Date(now).toISOString(),
  };
}

/**
 * Safeword button / PATCH { heat }: heat and intensity can only be lowered to
 * the ceiling, never raised, so a client cannot unlock or escalate anything.
 */
export function lowerHeatTo(profile: IntimacyProfile, ceiling: number, now = Date.now()): IntimacyProfile {
  const cap = Math.max(0, Math.min(100, Math.round(Number(ceiling) || 0)));
  return {
    ...profile,
    heat: Math.min(Number(profile.heat) || 0, cap),
    intensity: Math.min(currentIntensity(profile, now), cap),
    intensityAt: new Date(now).toISOString(),
  };
}
