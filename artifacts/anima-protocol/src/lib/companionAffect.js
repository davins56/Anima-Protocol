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
