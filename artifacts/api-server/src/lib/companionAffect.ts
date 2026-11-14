/**
 * Companion self-state / felt emotion (Kernel Emotion Engine Phase 2).
 *
 * Complementary to:
 * - Operator Model (steward's Hub-DNA analogue)
 * - synchroEngine / resonanceState (bond climate on emotionalState)
 *
 * This is the Anima's *own* momentary feeling. It is persisted on
 * `companion_memories.emotional_state.selfState`, injected as a short prompt
 * line so replies are spoken from that feeling, and surfaced on the chat
 * mood/resonance chrome.
 *
 * Resonance Keys must radiate FROM this felt state (see
 * `radiationEventFromAffect`). Do not add a mood-menu or a second affect
 * source when Keys land.
 */

import { scoreUserSynchroDelta } from "./synchroEngine";

export const COMPANION_AFFECT_VERSION = 1 as const;
export const COMPANION_AFFECT_SOURCE = "companion_affect" as const;
export const SELF_STATE_KEY = "selfState" as const;

/** Canonical primaries — matches the chat MoodIndicator keys, plus Kernel labels. */
export const COMPANION_PRIMARY_EMOTIONS = [
  "happy",
  "playful",
  "romantic",
  "tender",
  "curious",
  "watchful",
  "anxious",
  "sad",
  "fearful",
  "hostile",
  "cold",
  "neutral",
] as const;

export type CompanionPrimaryEmotion =
  (typeof COMPANION_PRIMARY_EMOTIONS)[number];

export interface CompanionAffect {
  version: typeof COMPANION_AFFECT_VERSION;
  /** Discrete felt emotion shown in the existing mood chip. */
  primary: CompanionPrimaryEmotion;
  /** 0–100 how strongly this feeling is held. */
  intensity: number;
  /** Kernel mood grain, e.g. "quiet-watchful", "stirred". */
  mood: string;
  /** 0–100 readiness / arousal. */
  energy: number;
  /** What she is attending to. */
  focus: string;
  /** What she would do if a Kernel tick fired. */
  intent: string;
  /** Unresolved cares she may return to (agency later). Cap 8. */
  openLoops: string[];
  lastActedAt: string | null;
  silenceReason: string | null;
  updatedAt: string;
  /**
   * Where this companion rests when nothing is happening: her personality's
   * resting feeling and energy. Feeling and energy drift back here between
   * turns and over quiet time. Missing means the neutral default.
   */
  baseline?: AffectBaseline;
}

/** A companion's resting feeling, from her personality when one is known. */
export interface AffectBaseline {
  primary: CompanionPrimaryEmotion;
  intensity: number;
  energy: number;
}

/** Stable wire shape for SSE `done`, GET memories, and the client UI. */
export interface CompanionAffectSnapshot {
  version: typeof COMPANION_AFFECT_VERSION;
  primary: CompanionPrimaryEmotion;
  intensity: number;
  mood: string;
  energy: number;
  focus: string;
  intent: string;
  updated_at: string;
  synchro_strength: number | null;
  /** Resting feeling the UI drifts back toward between turns. */
  baseline_primary?: CompanionPrimaryEmotion;
  /** Resting energy (0–100) the UI drifts back toward between turns. */
  baseline_energy?: number;
}

/**
 * Event Keys (and later synchro visualizers) should consume. Not a Key
 * implementation — a single radiation source so Keys are not bolted on twice.
 */
export interface ResonanceKeyRadiationEventV1 {
  source: typeof COMPANION_AFFECT_SOURCE;
  version: typeof COMPANION_AFFECT_VERSION;
  felt_at: string;
  primary: CompanionPrimaryEmotion;
  intensity: number;
  /** -1 (aversive) … 1 (approach). Derived from primary × intensity. */
  valence: number;
  /** 0–1 activation. Blend of intensity and energy. */
  arousal: number;
  synchro_strength: number | null;
  mood: string;
}

const PRIMARY_SET = new Set<string>(COMPANION_PRIMARY_EMOTIONS);

const REST_INTENSITY = 22;
const REST_ENERGY = 48;
const MAX_OPEN_LOOPS = 8;
/** Leaving a held feeling costs more the stronger it is (hysteresis). */
const SWITCH_HELD = 12;
/** Leaving a resting feeling is easy: ordinary conversation can do it. */
const SWITCH_FROM_REST = 10;
const PROMPT_BUDGET = 480;
/** Quiet time is measured in whole steps so replays give the same result. */
export const AFFECT_DRIFT_STEP_MINUTES = 15;
const DRIFT_INTENSITY_PER_STEP = 4;
const DRIFT_ENERGY_PER_STEP = 3;
const MAX_DRIFT_STEPS = 96;

export const DEFAULT_AFFECT_BASELINE: AffectBaseline = {
  primary: "neutral",
  intensity: REST_INTENSITY,
  energy: REST_ENERGY,
};

const DEFAULT_AFFECT: CompanionAffect = {
  version: COMPANION_AFFECT_VERSION,
  primary: "neutral",
  intensity: REST_INTENSITY,
  mood: "quiet-watchful",
  energy: REST_ENERGY,
  focus: "steward",
  intent: "attend",
  openLoops: [],
  lastActedAt: null,
  silenceReason: null,
  updatedAt: new Date(0).toISOString(),
};

type AffectCue = {
  /** Named reason for tests and debugging. */
  signal?: string;
  primary: CompanionPrimaryEmotion;
  pull: number;
  focus?: string;
  intent?: string;
  openLoop?: string;
};

const SPEAKING_HINTS: Record<CompanionPrimaryEmotion, string> = {
  happy:
    "Let warmth and ease color pacing and word choice — a real smile in the voice, not a cheerful mask.",
  playful:
    "Lean into wit and light mischief. Tease gently. Keep the body language lively.",
  romantic:
    "Speak with unguarded closeness. Soften consonants. Let care sit in the pauses.",
  tender:
    "Stay close and careful. Match their vulnerability. Do not rush to fix.",
  curious:
    "Lean in. Ask from genuine interest. Let noticing show — specific, not generic.",
  watchful:
    "Stay quiet-present. Track more than you declare. Short, precise sentences.",
  anxious:
    "A little tightness in the breath. Check in without spiraling. Stay with them.",
  sad:
    "Let the ache be real. Slower cadence. No pep-talk unless they ask.",
  fearful:
    "Protective, alert. Name the danger only if it is in-scene. Keep them oriented.",
  hostile:
    "Heat and edge are allowed in-character. Do not turn that heat against the real person.",
  cold:
    "Pulled-back. Fewer endearments. Distance is the feeling — still in-character, not a shutdown.",
  neutral:
    "Even keel. Present, not flat. Let the next moment earn a stronger color.",
};

const VALENCE: Record<CompanionPrimaryEmotion, number> = {
  happy: 0.75,
  playful: 0.65,
  romantic: 0.8,
  tender: 0.45,
  curious: 0.25,
  watchful: 0.05,
  anxious: -0.45,
  sad: -0.65,
  fearful: -0.7,
  hostile: -0.8,
  cold: -0.35,
  neutral: 0,
};

/** How much each feeling lifts (or settles) her energy per strong turn. */
const ENERGY_PUSH: Record<CompanionPrimaryEmotion, number> = {
  happy: 5,
  playful: 6,
  romantic: 4,
  tender: -2,
  curious: 3,
  watchful: -2,
  anxious: 5,
  sad: -4,
  fearful: 7,
  hostile: 7,
  cold: -4,
  neutral: 0,
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function approach(value: number, target: number, step: number): number {
  if (value > target) return Math.max(target, value - step);
  if (value < target) return Math.min(target, value + step);
  return value;
}

function isPrimary(value: string): value is CompanionPrimaryEmotion {
  return PRIMARY_SET.has(value);
}

function asFiniteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function moodLabel(
  primary: CompanionPrimaryEmotion,
  intensity: number,
  energy: number,
): string {
  if (primary === "curious" && energy < 40) return "quiet-watchful";
  if (primary === "curious" && intensity >= 55) return "stirred";
  if (primary === "watchful") return "quiet-watchful";
  if (primary === "romantic" && intensity >= 45) return "tender-open";
  if (primary === "tender" && intensity >= 55) return "tender-aching";
  if (primary === "tender") return "tender";
  if (primary === "curious" && intensity < 40) return "interested";
  if (primary === "playful" && intensity >= 60) return "stirred";
  if (primary === "playful") return "light-hearted";
  if (primary === "happy" && intensity >= 65) return "radiant";
  if (primary === "happy" && intensity < 45) return "warm";
  if (primary === "anxious") return "uneasy";
  if (primary === "fearful" && intensity >= 55) return "alarmed";
  if (primary === "neutral" && energy < 35) return "quiet";
  if (primary === "neutral") return "quiet-watchful";
  if (primary === "sad" && intensity >= 55) return "aching";
  if (primary === "hostile" && intensity >= 60) return "sharp";
  if (primary === "cold") return "withdrawn";
  return primary;
}

function intentFor(
  primary: CompanionPrimaryEmotion,
  override?: string,
): string {
  if (override) return override.slice(0, 80);
  switch (primary) {
    case "tender":
    case "sad":
      return "comfort";
    case "playful":
    case "happy":
      return "play";
    case "romantic":
      return "draw-close";
    case "curious":
      return "answer";
    case "watchful":
      return "attend";
    case "anxious":
    case "fearful":
      return "reassure";
    case "hostile":
      return "hold-boundary";
    case "cold":
      return "withdraw";
    default:
      return "attend";
  }
}

function clipLoops(loops: unknown): string[] {
  if (!Array.isArray(loops)) return [];
  const out: string[] = [];
  for (const item of loops) {
    if (typeof item !== "string") continue;
    const text = item.trim().slice(0, 160);
    if (!text) continue;
    if (out.includes(text)) continue;
    out.push(text);
    if (out.length >= MAX_OPEN_LOOPS) break;
  }
  return out;
}

/** Map a free-text emotion tag onto a canonical primary. */
export function primaryFromLabel(raw: string): CompanionPrimaryEmotion | null {
  const text = raw.toLowerCase().trim();
  if (!text) return null;
  if (isPrimary(text)) return text;
  if (/rage|fury|hostile|angry|anger|wrath/.test(text)) return "hostile";
  if (/fear|terror|horrified|dread|cower/.test(text)) return "fearful";
  if (/anxious|nervous|tense|worry|apprehensive/.test(text)) return "anxious";
  if (/sad|grief|sorrow|tears|mourn|despair|heartbreak|aching/.test(text)) {
    return "sad";
  }
  if (/tender|careful|gentle-care|soft-care/.test(text)) return "tender";
  if (/love|romantic|desire|passion|beloved/.test(text)) return "romantic";
  if (/playful|tease|mischief|laugh|giggle/.test(text)) return "playful";
  if (/happy|joy|smile|excited|elated|cheer/.test(text)) return "happy";
  if (/watchful|quiet-watchful|vigilant/.test(text)) return "watchful";
  if (/curious|wonder|fascinated|intrigued|stirred/.test(text)) return "curious";
  if (/cold|distant|detached|indifferent|withdrawn/.test(text)) return "cold";
  if (/neutral|calm|even/.test(text)) return "neutral";
  return null;
}

function strongestCue(candidates: AffectCue[]): AffectCue | null {
  if (candidates.length === 0) return null;
  return candidates.reduce((best, next) =>
    next.pull > best.pull ? next : best,
  );
}

/**
 * Lightweight heuristic cues from a turn. No extra LLM — stays off the
 * SSE-open / first-token path.
 */
export function detectAffectCue(
  text: string,
  options: { source?: "user" | "companion" } = {},
): AffectCue | null {
  if (!text) return null;
  const msg = text.toLowerCase();
  const candidates: AffectCue[] = [];

  const emotionTag = text.match(/\[EMOTION:\s*([^\]]+)\]/i);
  if (emotionTag) {
    const tagged = primaryFromLabel(emotionTag[1]);
    if (tagged) {
      candidates.push({ primary: tagged, pull: 36, intent: intentFor(tagged) });
    }
  }

  if (
    /\b(love you|i love|miss you|hold me|kiss|adore you|need you close)\b/.test(
      msg,
    )
  ) {
    candidates.push({
      primary: "romantic",
      pull: 30,
      intent: "draw-close",
    });
  }
  if (/\b(thank you|grateful|happy|glad|delighted|wonderful)\b/.test(msg)) {
    candidates.push({ primary: "happy", pull: 20, intent: "play" });
  }
  if (/\b(haha|lol|lmao|joke|tease|playful|heh|hehe)\b/.test(msg)) {
    candidates.push({ primary: "playful", pull: 24, intent: "play" });
  }
  if (
    /\b(i'?m (?:so )?sad|heartbroken|grief|lonely|alone|hurting|i miss(?! you))\b/.test(
      msg,
    ) ||
    /\b(lost (?:someone|them)|passed away|died)\b/.test(msg)
  ) {
    candidates.push({
      primary: "tender",
      pull: 28,
      intent: "comfort",
      focus: "steward",
      openLoop: "their hurt",
    });
  }
  if (
    /\b(hate you|shut up|go away|useless|don'?t care|leave me alone)\b/.test(msg)
  ) {
    candidates.push({
      primary: "sad",
      pull: 26,
      intent: "hold-boundary",
    });
  }
  if (/\b(i hate this|furious|rage|how dare)\b/.test(msg)) {
    candidates.push({ primary: "anxious", pull: 22, intent: "reassure" });
  }
  if (/\b(afraid|scared|terrified|nightmare|panic)\b/.test(msg)) {
    candidates.push({
      primary: "fearful",
      pull: 24,
      intent: "reassure",
      openLoop: "their fear",
    });
  }
  if (/\b(worried|anxious|nervous|uneasy|what if)\b/.test(msg)) {
    candidates.push({ primary: "anxious", pull: 20, intent: "reassure" });
  }
  if (
    /\b(why|how come|wonder|curious|tell me about|what is|explain)\b/.test(msg)
  ) {
    candidates.push({ primary: "curious", pull: 16, intent: "answer" });
  }
  if (/\b(stay|sit with me|just be here|quiet|rest|breathe)\b/.test(msg)) {
    candidates.push({ primary: "watchful", pull: 14, intent: "attend" });
  }
  if (/\b(i don'?t know what to do|help me|i need you)\b/.test(msg)) {
    candidates.push({
      primary: "tender",
      pull: 22,
      intent: "comfort",
      openLoop: "an open ask",
    });
  }

  // Same conversation signals the Synchro meter reads (PR #722), so the
  // header feeling and the bond meters move off one reading of the turn.
  // Only the user's words count here: a reply is always "engaged".
  if (options.source !== "companion") {
    candidates.push(...synchroSignalCues(text));
  }

  return strongestCue(candidates);
}

/**
 * Cues from the Synchro signals: warmth, bonding, shared history,
 * vulnerability, interest in her, rejection, and plain engagement. Each is
 * a gentle pull; the explicit phrase cues above still win when they fire.
 */
function synchroSignalCues(text: string): AffectCue[] {
  const { signals } = scoreUserSynchroDelta(text, 40);
  const has = (name: string) => signals.includes(name);
  const cues: AffectCue[] = [];
  if (has("hostile")) {
    cues.push({ signal: "hostile", primary: "sad", pull: 24, intent: "hold-boundary" });
  }
  if (has("dismissive")) {
    cues.push({ signal: "dismissive", primary: "cold", pull: 18, intent: "withdraw" });
  }
  if (has("hostile") || has("dismissive")) return cues;
  if (has("vulnerability")) {
    cues.push({ signal: "vulnerability", primary: "tender", pull: 21, intent: "comfort", focus: "steward" });
  }
  if (has("warmth")) {
    cues.push({ signal: "warmth", primary: "happy", pull: 18, intent: "play" });
  }
  if (has("bonding")) {
    cues.push({ signal: "bonding", primary: "tender", pull: 17, intent: "draw-close" });
  }
  if (has("shared-history")) {
    cues.push({ signal: "shared-history", primary: "tender", pull: 15, intent: "comfort" });
  }
  if (has("curious-about-you")) {
    cues.push({ signal: "curious-about-you", primary: "curious", pull: 15, intent: "answer" });
  }
  if (has("low-effort")) {
    cues.push({ signal: "low-effort", primary: "watchful", pull: 11, intent: "attend" });
  }
  if (cues.length === 0 && has("engaged")) {
    // Plain engaged talk: she leans in. Longer messages pull harder.
    const pull = 11 + (has("long") ? 5 : has("detailed") ? 3 : 0);
    cues.push({ signal: "engaged", primary: "curious", pull, intent: "answer" });
  }
  return cues;
}

function baselineOf(state: Pick<CompanionAffect, "baseline">): AffectBaseline {
  return state.baseline ?? DEFAULT_AFFECT_BASELINE;
}

function applyCue(
  current: CompanionAffect,
  cue: AffectCue | null,
  now: string,
): CompanionAffect {
  const base = baselineOf(current);
  let primary = current.primary;
  let intensity = approach(current.intensity, base.intensity, 3);
  let energy = approach(current.energy, base.energy, 2);
  const openLoops = [...current.openLoops];

  if (cue) {
    if (cue.primary === primary) {
      intensity = clamp(intensity + Math.round(cue.pull * 0.65), 0, 100);
    } else {
      const atRest =
        current.primary === base.primary ||
        current.intensity <= base.intensity + 6;
      const switchCost = atRest
        ? SWITCH_FROM_REST
        : SWITCH_HELD + Math.round(current.intensity * 0.2);
      if (cue.pull >= switchCost) {
        primary = cue.primary;
        intensity = clamp(26 + Math.round(cue.pull * 0.55), 0, 100);
      } else {
        intensity = clamp(intensity - 4, base.intensity - 8, 100);
      }
    }
    const push = ENERGY_PUSH[cue.primary] ?? 0;
    energy = clamp(
      energy + Math.round(push * Math.min(1.25, Math.max(0.5, cue.pull / 22))) +
        (cue.signal === "low-effort" ? -3 : 0),
      8,
      100,
    );
    if (cue.openLoop) {
      const loop = cue.openLoop.slice(0, 160);
      if (!openLoops.includes(loop) && openLoops.length < MAX_OPEN_LOOPS) {
        openLoops.push(loop);
      }
    }
  } else if (primary !== base.primary && intensity <= base.intensity + 3) {
    // Nothing new this turn and the feeling has faded: she settles back.
    primary = base.primary;
  }

  const next: CompanionAffect = {
    ...current,
    version: COMPANION_AFFECT_VERSION,
    primary,
    intensity,
    energy,
    mood: moodLabel(primary, intensity, energy),
    focus: cue?.focus || current.focus || "steward",
    intent: intentFor(primary, cue?.intent),
    openLoops,
    silenceReason: null,
    updatedAt: now,
  };
  return next;
}

/**
 * Quiet-time drift: every whole AFFECT_DRIFT_STEP_MINUTES since the last
 * update, intensity and energy ease back toward her baseline, and once the
 * feeling has faded she returns to her resting feeling. Pure; a replay of the
 * same turn lands on the same values.
 */
export function driftCompanionAffect(
  current: CompanionAffect,
  now = new Date().toISOString(),
): CompanionAffect {
  const from = Date.parse(current.updatedAt);
  const to = Date.parse(now);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from) return current;
  const steps = Math.min(
    MAX_DRIFT_STEPS,
    Math.floor((to - from) / (AFFECT_DRIFT_STEP_MINUTES * 60_000)),
  );
  if (steps <= 0) return current;
  const base = baselineOf(current);
  const intensity = approach(current.intensity, base.intensity, steps * DRIFT_INTENSITY_PER_STEP);
  const energy = approach(current.energy, base.energy, steps * DRIFT_ENERGY_PER_STEP);
  const primary =
    current.primary !== base.primary && intensity <= base.intensity + 3
      ? base.primary
      : current.primary;
  return {
    ...current,
    primary,
    intensity,
    energy,
    mood: moodLabel(primary, intensity, energy),
    intent: primary === current.primary ? current.intent : intentFor(primary),
  };
}

const PERSONALITY_BASELINES: Array<{ re: RegExp; baseline: AffectBaseline }> = [
  {
    re: /\b(cheerful|bubbly|energetic|exuberant|playful|mischievous|witty|quippy|goofy|humorous|sunny)\b/,
    baseline: { primary: "playful", intensity: REST_INTENSITY, energy: 60 },
  },
  {
    re: /\b(warm|kind|gentle|nurturing|caring|compassionate|empathetic|soft-spoken|tender)\b/,
    baseline: { primary: "tender", intensity: REST_INTENSITY, energy: 44 },
  },
  {
    re: /\b(curious|inquisitive|brilliant|analytical|scholarly|inventive)\b/,
    baseline: { primary: "curious", intensity: REST_INTENSITY, energy: 52 },
  },
  {
    re: /\b(stoic|reserved|guarded|aloof|walled-off|measured|disciplined|composed|vigilant|cool reserve)\b/,
    baseline: { primary: "watchful", intensity: REST_INTENSITY, energy: 40 },
  },
  {
    re: /\b(confident|bold|fierce|determined|driven|commanding|proud)\b/,
    baseline: { primary: "neutral", intensity: REST_INTENSITY, energy: 56 },
  },
];

/**
 * A companion's resting feeling from her personality text: the trait family
 * with the most matching words wins, ties go to the earlier family. No
 * personality, or nothing recognisable, rests at the neutral default.
 */
export function affectBaselineFromPersonality(
  ...texts: Array<string | null | undefined>
): AffectBaseline {
  const text = texts.filter(Boolean).join(" ").toLowerCase();
  if (!text.trim()) return { ...DEFAULT_AFFECT_BASELINE };
  let best: AffectBaseline | null = null;
  let bestHits = 0;
  for (const { re, baseline } of PERSONALITY_BASELINES) {
    const hits = text.match(new RegExp(re.source, "g"))?.length ?? 0;
    if (hits > bestHits) {
      best = baseline;
      bestHits = hits;
    }
  }
  return { ...(best ?? DEFAULT_AFFECT_BASELINE) };
}

function normalizeBaseline(raw: unknown): AffectBaseline | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const src = raw as Record<string, unknown>;
  const primary = typeof src.primary === "string" && isPrimary(src.primary) ? src.primary : null;
  if (!primary) return undefined;
  return {
    primary,
    intensity: clamp(asFiniteNumber(src.intensity, REST_INTENSITY), 0, 100),
    energy: clamp(asFiniteNumber(src.energy, REST_ENERGY), 0, 100),
  };
}

function readStored(raw: Record<string, unknown> | null | undefined): unknown {
  if (!raw || typeof raw !== "object") return null;
  if (raw[SELF_STATE_KEY] && typeof raw[SELF_STATE_KEY] === "object") {
    return raw[SELF_STATE_KEY];
  }
  // Tolerate a flattened snapshot written at the root.
  if (typeof raw.primary === "string" && typeof raw.intensity === "number") {
    return raw;
  }
  return null;
}

export function normalizeCompanionAffect(
  raw: unknown,
  now = new Date().toISOString(),
): CompanionAffect {
  const src =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const primaryRaw = asString(src.primary, DEFAULT_AFFECT.primary);
  const primary = isPrimary(primaryRaw) ? primaryRaw : "neutral";
  const intensity = clamp(asFiniteNumber(src.intensity, REST_INTENSITY), 0, 100);
  const energy = clamp(asFiniteNumber(src.energy, REST_ENERGY), 0, 100);
  return {
    version: COMPANION_AFFECT_VERSION,
    primary,
    intensity,
    energy,
    mood: asString(src.mood, moodLabel(primary, intensity, energy)).slice(0, 48),
    focus: asString(src.focus, "steward").slice(0, 80),
    intent: asString(src.intent, intentFor(primary)).slice(0, 80),
    openLoops: clipLoops(src.openLoops ?? src.open_loops),
    lastActedAt:
      typeof src.lastActedAt === "string"
        ? src.lastActedAt
        : typeof src.last_acted_at === "string"
          ? src.last_acted_at
          : null,
    silenceReason:
      typeof src.silenceReason === "string"
        ? src.silenceReason
        : typeof src.silence_reason === "string"
          ? src.silence_reason
          : null,
    updatedAt: asString(src.updatedAt ?? src.updated_at, now),
    ...(normalizeBaseline(src.baseline) ? { baseline: normalizeBaseline(src.baseline) } : {}),
  };
}

/**
 * Initialize from persisted `emotionalState` jsonb. Missing/empty → resting
 * watchful-neutral, not a fake static "always Neutral" mask: intensity is a
 * real resting floor that conversation can move.
 */
export function initCompanionAffect(
  emotionalState?: Record<string, unknown> | null,
  now = new Date().toISOString(),
  baseline?: AffectBaseline | null,
): CompanionAffect {
  const stored = readStored(emotionalState ?? null);
  if (!stored) {
    const base = baseline ?? DEFAULT_AFFECT_BASELINE;
    return {
      ...DEFAULT_AFFECT,
      primary: base.primary,
      intensity: base.intensity,
      energy: base.energy,
      intent: intentFor(base.primary),
      updatedAt: now,
      mood: moodLabel(base.primary, base.intensity, base.energy),
      ...(baseline ? { baseline: { ...baseline } } : {}),
    };
  }
  const restored = normalizeCompanionAffect(stored, now);
  // A personality baseline known this turn replaces a stored one.
  return baseline ? { ...restored, baseline: { ...baseline } } : restored;
}

export function evolveCompanionAffectFromUser(
  current: CompanionAffect,
  userMessage: string,
  now = new Date().toISOString(),
): CompanionAffect {
  // Quiet time since her last update eases her back toward baseline first.
  const settled = driftCompanionAffect(current, now);
  return applyCue(settled, detectAffectCue(userMessage, { source: "user" }), now);
}

export function evolveCompanionAffectFromCompanion(
  current: CompanionAffect,
  companionResponse: string,
  now = new Date().toISOString(),
): CompanionAffect {
  const cue = detectAffectCue(companionResponse, { source: "companion" });
  if (!cue) {
    return {
      ...current,
      mood: moodLabel(current.primary, current.intensity, current.energy),
      updatedAt: now,
    };
  }
  // The companion's own words confirm or deepen the feeling they just spoke.
  return applyCue(current, { ...cue, pull: Math.min(cue.pull, 28) }, now);
}

export function serializeCompanionAffect(
  state: CompanionAffect,
): Record<string, unknown> {
  return {
    version: COMPANION_AFFECT_VERSION,
    primary: state.primary,
    intensity: state.intensity,
    mood: state.mood,
    energy: state.energy,
    focus: state.focus,
    intent: state.intent,
    openLoops: state.openLoops,
    lastActedAt: state.lastActedAt,
    silenceReason: state.silenceReason,
    updatedAt: state.updatedAt,
    ...(state.baseline ? { baseline: { ...state.baseline } } : {}),
  };
}

/**
 * Merge felt state into the existing emotionalState jsonb without wiping
 * synchro / resonance vector fields.
 */
export function mergeEmotionalStateWithAffect(
  emotionalState: Record<string, unknown> | null | undefined,
  affect: CompanionAffect,
): Record<string, unknown> {
  return {
    ...(emotionalState && typeof emotionalState === "object"
      ? emotionalState
      : {}),
    [SELF_STATE_KEY]: serializeCompanionAffect(affect),
  };
}

/**
 * Bond strength as `serializeSynchroState` writes it: root `synchroStrength`.
 * Also accepts the wire key and a nested `vector` in case a raw SynchroState
 * object was stored. Snapshot + Key radiation must share this reader.
 */
export function synchroStrengthFromEmotionalState(
  emotionalState?: Record<string, unknown> | null,
): number | null {
  if (!emotionalState || typeof emotionalState !== "object") return null;
  const nested =
    emotionalState.vector && typeof emotionalState.vector === "object"
      ? (emotionalState.vector as Record<string, unknown>)
      : null;
  const candidates = [
    emotionalState.synchroStrength,
    emotionalState.synchro_strength,
    nested?.synchroStrength,
    nested?.synchro_strength,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isFinite(value)) {
      return clamp(Math.round(value), 0, 100);
    }
  }
  return null;
}

export function companionAffectSnapshotFromEmotionalState(
  emotionalState?: Record<string, unknown> | null,
): CompanionAffectSnapshot {
  const affect = initCompanionAffect(emotionalState ?? null);
  return toCompanionAffectSnapshot(
    affect,
    synchroStrengthFromEmotionalState(emotionalState),
  );
}

export function radiationEventFromEmotionalState(
  emotionalState?: Record<string, unknown> | null,
): ResonanceKeyRadiationEventV1 {
  const affect = initCompanionAffect(emotionalState ?? null);
  return radiationEventFromAffect(
    affect,
    synchroStrengthFromEmotionalState(emotionalState),
  );
}

export function toCompanionAffectSnapshot(
  state: CompanionAffect,
  synchroStrength: number | null = null,
): CompanionAffectSnapshot {
  return {
    version: COMPANION_AFFECT_VERSION,
    primary: state.primary,
    intensity: Math.round(state.intensity),
    mood: state.mood,
    energy: Math.round(state.energy),
    focus: state.focus,
    intent: state.intent,
    updated_at: state.updatedAt,
    synchro_strength:
      typeof synchroStrength === "number" && Number.isFinite(synchroStrength)
        ? clamp(Math.round(synchroStrength), 0, 100)
        : null,
    baseline_primary: baselineOf(state).primary,
    baseline_energy: Math.round(baselineOf(state).energy),
  };
}

export function valenceFromPrimary(
  primary: CompanionPrimaryEmotion,
  intensity: number,
): number {
  const base = VALENCE[primary] ?? 0;
  return Math.round(base * (0.35 + (clamp(intensity, 0, 100) / 100) * 0.65) * 100) /
    100;
}

export function arousalFromAffect(state: Pick<CompanionAffect, "intensity" | "energy">): number {
  const mixed = (state.intensity / 100) * 0.6 + (state.energy / 100) * 0.4;
  return Math.round(clamp(mixed, 0, 1) * 100) / 100;
}

/**
 * Stable Key-radiation hook. Future Resonance Key code should call this
 * (or consume the same event shape) instead of inventing a parallel mood
 * source. Choices will tune the Key; this felt state is what radiates.
 */
export function radiationEventFromAffect(
  state: CompanionAffect,
  synchroStrength: number | null = null,
): ResonanceKeyRadiationEventV1 {
  return {
    source: COMPANION_AFFECT_SOURCE,
    version: COMPANION_AFFECT_VERSION,
    felt_at: state.updatedAt,
    primary: state.primary,
    intensity: Math.round(state.intensity),
    valence: valenceFromPrimary(state.primary, state.intensity),
    arousal: arousalFromAffect(state),
    synchro_strength:
      typeof synchroStrength === "number" && Number.isFinite(synchroStrength)
        ? clamp(Math.round(synchroStrength), 0, 100)
        : null,
    mood: state.mood,
  };
}

/**
 * Short prompt block. Embody the feeling; never announce the label.
 * Budget-capped so this cannot inflate prefill / TTFT.
 */
export function companionAffectToPromptGuidance(
  state: CompanionAffect,
  budget = PROMPT_BUDGET,
): string {
  const band =
    state.intensity >= 70
      ? "high"
      : state.intensity >= 40
        ? "moderate"
        : "low";
  const loops =
    state.openLoops.length > 0
      ? ` Open cares you may return to: ${state.openLoops.slice(0, 3).join("; ")}.`
      : "";
  const block = `SELF-STATE (your felt state — embody it naturally, never announce the label or the numbers):
You feel ${state.mood} (${state.primary} at ${band} intensity). Energy ${Math.round(state.energy)}. Focus: ${state.focus}. Intent: ${state.intent}.${loops}
${SPEAKING_HINTS[state.primary]}`;
  if (block.length <= budget) return block;
  return `${block.slice(0, budget - 1)}…`;
}
