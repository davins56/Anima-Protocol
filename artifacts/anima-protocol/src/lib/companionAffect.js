// @ts-check
/**
 * Client contract for companion felt-state (Kernel self-state).
 *
 * Server is the source of truth (`companion_memories.emotional_state.selfState`).
 * The chat toolbar mood chip and Resonance Field read this snapshot — not a
 * mood-menu UX. Future Resonance Keys must radiate FROM
 * `radiationEventFromAffect` rather than a second mood source.
 */

export const COMPANION_AFFECT_SOURCE = "companion_affect";
export const COMPANION_AFFECT_VERSION = 1;

/** @typedef {"happy"|"playful"|"romantic"|"tender"|"curious"|"watchful"|"anxious"|"sad"|"fearful"|"hostile"|"cold"|"neutral"} CompanionPrimaryEmotion */

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {unknown} raw
 * @returns {null | {
 *   version: number,
 *   primary: string,
 *   intensity: number,
 *   mood: string,
 *   energy: number,
 *   focus: string,
 *   intent: string,
 *   updated_at: string,
 *   synchro_strength: number | null,
 *   baseline_primary: string,
 *   baseline_energy: number,
 * }}
 */
export function parseCompanionAffectSnapshot(raw) {
  if (!isRecord(raw)) return null;
  const primary = typeof raw.primary === "string" ? raw.primary.trim().toLowerCase() : "";
  if (!primary) return null;
  const intensity = Number(raw.intensity);
  const energy = Number(raw.energy);
  return {
    version: Number(raw.version) === COMPANION_AFFECT_VERSION ? COMPANION_AFFECT_VERSION : 1,
    primary,
    intensity: Number.isFinite(intensity) ? Math.max(0, Math.min(100, Math.round(intensity))) : 22,
    mood: typeof raw.mood === "string" && raw.mood.trim() ? raw.mood.trim() : primary,
    energy: Number.isFinite(energy) ? Math.max(0, Math.min(100, Math.round(energy))) : 48,
    focus: typeof raw.focus === "string" ? raw.focus : "steward",
    intent: typeof raw.intent === "string" ? raw.intent : "attend",
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : "",
    synchro_strength:
      typeof raw.synchro_strength === "number" && Number.isFinite(raw.synchro_strength)
        ? Math.max(0, Math.min(100, Math.round(raw.synchro_strength)))
        : null,
    baseline_primary:
      typeof raw.baseline_primary === "string" && raw.baseline_primary.trim()
        ? raw.baseline_primary.trim().toLowerCase()
        : "neutral",
    baseline_energy:
      typeof raw.baseline_energy === "number" && Number.isFinite(raw.baseline_energy)
        ? Math.max(0, Math.min(100, Math.round(raw.baseline_energy)))
        : REST_ENERGY,
  };
}

/**
 * Shape the existing ChatHeader / theming / TTS already consume.
 * Intensity is 0–10 there; arousal maps from energy (0–100).
 *
 * @param {ReturnType<typeof parseCompanionAffectSnapshot>} snapshot
 */
export function characterEmotionFromAffect(snapshot) {
  if (!snapshot) return null;
  return {
    emotion: snapshot.primary,
    intensity: Math.round(snapshot.intensity / 10),
    emotion_level: snapshot.mood,
    arousal: snapshot.energy,
    source: COMPANION_AFFECT_SOURCE,
    // Drift inputs: the 0–100 values and her resting point.
    intensity_pct: snapshot.intensity,
    felt_at: snapshot.updated_at || "",
    baseline_primary: snapshot.baseline_primary || "neutral",
    baseline_energy: snapshot.baseline_energy ?? REST_ENERGY,
  };
}

const REST_INTENSITY = 22;
const REST_ENERGY = 48;
/** Must match AFFECT_DRIFT_STEP_MINUTES and the per-step easing on the server. */
export const AFFECT_DRIFT_STEP_MINUTES = 15;
const DRIFT_INTENSITY_PER_STEP = 4;
const DRIFT_ENERGY_PER_STEP = 3;
const MAX_DRIFT_STEPS = 96;

/**
 * Same Level words the server picks (api-server lib/companionAffect.ts
 * moodLabel), so a drifted header never shows a label the server can't.
 */
export function affectLevelLabel(primary, intensity, energy) {
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

function easeToward(value, target, step) {
  if (value > target) return Math.max(target, value - step);
  if (value < target) return Math.min(target, value + step);
  return value;
}

/**
 * Slow drift back toward her baseline while the chat is quiet, in the same
 * whole 15-minute steps the server applies on the next turn. Only entries
 * that came from the server felt state drift; anything else is returned as is.
 *
 * @param {Record<string, any> | null | undefined} emotion
 * @param {number} [now]
 */
export function driftCharacterEmotion(emotion, now = Date.now()) {
  if (!emotion || emotion.source !== COMPANION_AFFECT_SOURCE) return emotion;
  const from = Date.parse(emotion.felt_at || "");
  if (!Number.isFinite(from) || now <= from) return emotion;
  const steps = Math.min(MAX_DRIFT_STEPS, Math.floor((now - from) / (AFFECT_DRIFT_STEP_MINUTES * 60_000)));
  if (steps <= 0) return emotion;
  const basePrimary = emotion.baseline_primary || "neutral";
  const baseEnergy = Number.isFinite(emotion.baseline_energy) ? emotion.baseline_energy : REST_ENERGY;
  const startPct = Number.isFinite(emotion.intensity_pct) ? emotion.intensity_pct : Number(emotion.intensity || 0) * 10;
  const startEnergy = Number.isFinite(Number(emotion.arousal)) ? Number(emotion.arousal) : REST_ENERGY;
  const pct = easeToward(startPct, REST_INTENSITY, steps * DRIFT_INTENSITY_PER_STEP);
  const energy = easeToward(startEnergy, baseEnergy, steps * DRIFT_ENERGY_PER_STEP);
  const primary = emotion.emotion !== basePrimary && pct <= REST_INTENSITY + 3 ? basePrimary : emotion.emotion;
  if (pct === startPct && energy === startEnergy && primary === emotion.emotion) return emotion;
  return {
    ...emotion,
    emotion: primary,
    intensity: Math.round(pct / 10),
    intensity_pct: pct,
    arousal: energy,
    emotion_level: affectLevelLabel(primary, pct, energy),
    drifted: true,
  };
}

function valenceFromPrimary(primary, intensity) {
  const table = {
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
  const base = table[primary] ?? 0;
  const scaled = base * (0.35 + (Math.max(0, Math.min(100, intensity)) / 100) * 0.65);
  return Math.round(scaled * 100) / 100;
}

/**
 * Stable hook for future Resonance Key radiation. Do not invent a parallel
 * mood source when Keys land — call this (or consume the same event).
 *
 * @param {ReturnType<typeof parseCompanionAffectSnapshot>} snapshot
 * @returns {null | {
 *   source: string,
 *   version: number,
 *   felt_at: string,
 *   primary: string,
 *   intensity: number,
 *   valence: number,
 *   arousal: number,
 *   synchro_strength: number | null,
 *   mood: string,
 * }}
 */
export function radiationEventFromAffect(snapshot) {
  if (!snapshot) return null;
  const intensity = snapshot.intensity;
  const energy = snapshot.energy;
  return {
    source: COMPANION_AFFECT_SOURCE,
    version: COMPANION_AFFECT_VERSION,
    felt_at: snapshot.updated_at,
    primary: snapshot.primary,
    intensity,
    valence: valenceFromPrimary(snapshot.primary, intensity),
    arousal: Math.round(((intensity / 100) * 0.6 + (energy / 100) * 0.4) * 100) / 100,
    synchro_strength: snapshot.synchro_strength,
    mood: snapshot.mood,
  };
}

const INTENT_PHRASES = {
  comfort: "comfort you",
  play: "play along with you",
  "draw-close": "be close to you",
  answer: "answer what you asked",
  attend: "pay close attention to you",
  reassure: "reassure you",
  "hold-boundary": "hold a boundary",
  withdraw: "keep a little distance",
};

function levelWord(value, low, high) {
  if (value < low) return "low";
  if (value > high) return "high";
  return "steady";
}

/**
 * "Why she feels this" — plain-language reasons from the same server
 * snapshot the mood chip shows (no second mood source, no model call).
 *
 * @param {ReturnType<typeof parseCompanionAffectSnapshot>} snapshot
 * @param {string} [name]
 * @param {number} [now]
 * @returns {string[]}
 */
export function explainCompanionAffect(snapshot, name = "", now = Date.now()) {
  if (!snapshot) return [];
  const who = String(name || "").trim() || "She";
  const strength = snapshot.intensity >= 70 ? "strongly" : snapshot.intensity >= 40 ? "clearly" : "faintly";
  const lines = [
    snapshot.mood && snapshot.mood !== snapshot.primary
      ? `${who} feels ${strength} ${snapshot.primary} — "${snapshot.mood}".`
      : `${who} feels ${strength} ${snapshot.primary}.`,
  ];
  const intent = INTENT_PHRASES[snapshot.intent] || (snapshot.intent ? snapshot.intent.replace(/-/g, " ") : "");
  if (intent) lines.push(`Right now she wants to ${intent}.`);
  lines.push(
    snapshot.focus === "steward" || !snapshot.focus
      ? "Her attention is on you and what you just said."
      : `Her attention is on ${snapshot.focus}.`,
  );
  lines.push(`Her energy is ${levelWord(snapshot.energy, 34, 66)} (${snapshot.energy}/100).`);
  if (snapshot.synchro_strength != null) {
    lines.push(`Your bond signal is at ${snapshot.synchro_strength}% — it colours how openly she shows it.`);
  }
  const at = Date.parse(snapshot.updated_at || "");
  if (Number.isFinite(at)) {
    const mins = Math.max(0, Math.round((now - at) / 60000));
    lines.push(mins < 1 ? "This shifted with her last reply." : mins < 60 ? `This shifted ${mins} min ago.` : `This shifted ${Math.round(mins / 60)} h ago.`);
  }
  return lines;
}
