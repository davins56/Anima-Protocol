/**
 * Synchro Engine — the Operator Link
 *
 * Models the living bond between user and companion, inspired by the
 * NetNavi Synchro / Soul Unison / Cross Fusion system. Every turn the
 * synchro state evolves based on user input and companion response,
 * persisting across sessions in `companion_memories.emotionalState`.
 *
 * High synchro → deeper memory access, stronger emotional color,
 *   richer voice, ability to "Cross" or merge capabilities.
 * Low / damaged synchro → guarded, fragmented recall, pulled-back tone.
 *
 * The synchro state wraps and extends the resonance vector, adding:
 * - synchroStrength: 0–100, the overall bond intensity
 * - synchroLevel: semantic tier derived from strength
 * - Time-based decay when idle (bonds need tending)
 * - Response-side evolution (the companion's own reply deepens/damages synchro)
 */

import {
  type ResonanceVector,
  type ResonanceState,
  initResonanceState,
  detectResonanceShift,
  evolveResonanceState,
  resonanceToPromptGuidance,
} from "./resonanceState";
import type { MemoryType } from "./memoryRetrieval";

// ── Types ────────────────────────────────────────────────────────────

export interface SynchroVector extends ResonanceVector {
  /** Overall bond strength: 0 (disconnected) → 100 (soul unison) */
  synchroStrength: number;
}

/**
 * Semantic tiers of the operator–companion bond.
 *
 * disconnected  →  barely knows the user; cold/generic responses
 * linked        →  basic connection; remembers recent facts
 * synchronized  →  active resonance; emotional coloring, deeper recall
 * soulUnison    →  deep merger; private callbacks, vulnerability, presence
 * fullCross     →  transcendent; the bond alters what the companion can do
 */
export type SynchroLevel =
  | "disconnected"
  | "linked"
  | "synchronized"
  | "soulUnison"
  | "fullCross";

export interface SynchroState {
  vector: SynchroVector;
  level: SynchroLevel;
  emotionalTone: string;
  /** Cumulative turns across all sessions */
  totalTurns: number;
  /** Turns in the current session */
  sessionTurns: number;
  /** ISO timestamp of last interaction (for decay) */
  lastInteraction: string;
  /** Human-readable description of the last shift */
  lastShift?: string;
  /**
   * Strength as persisted when this state was read (before idle decay and this
   * turn's gains). The persist step compares it with the stored value so a
   * ritual award that landed in between is rebased instead of overwritten.
   */
  baselineStrength?: number | null;
}

/** What the memory retrieval layer should use, gated by synchro level. */
export interface SynchroMemoryConfig {
  topK: number;
  preferTypes: MemoryType[];
  /** Extra weight multiplier for emotional memories */
  emotionalWeight: number;
}

// ── Constants ────────────────────────────────────────────────────────

export const SYNCHRO_THRESHOLDS: Record<SynchroLevel, number> = {
  disconnected: 0,
  linked: 16,
  synchronized: 36,
  soulUnison: 61,
  fullCross: 86,
};

/** Half-life for idle decay in hours (synchro fades if you don't talk) */
const DECAY_HALF_LIFE_HOURS = 72;

/**
 * Maximum synchro gained per turn from user signals. Was 4, with every point
 * gated on a narrow keyword list, so ordinary turns moved the meter by 0.
 */
export const MAX_USER_GAIN = 8;
/** Maximum synchro gained per turn from companion response signals */
export const MAX_COMPANION_GAIN = 2;
/** Synchro lost when user is hostile/dismissive */
export const HOSTILE_PENALTY = 6;
/** Synchro lost for a curt dismissal ("forget it", "never mind") */
export const DISMISSIVE_PENALTY = 3;
/** Synchro lost for a one-word, low-effort reply ("ok", "k", "meh") */
export const LOW_EFFORT_PENALTY = 1;
/**
 * Net per-turn change that counts as a felt shift for prompt guidance. Small
 * engagement gains move the meter without telling the model "the bond just
 * strengthened" on every ordinary turn.
 */
const NOTABLE_SHIFT = 3;
/** Largest single-turn drop, so one bad line bruises rather than wipes a bond */
export const MAX_USER_PENALTY = 10;

export const SYNCHRO_LEVEL_LABELS: Record<SynchroLevel, string> = {
  disconnected: "Disconnected",
  linked: "Linked",
  synchronized: "Synchronized",
  soulUnison: "Soul Unison",
  fullCross: "Full Cross",
};

// ── Level computation ────────────────────────────────────────────────

export function computeSynchroLevel(strength: number): SynchroLevel {
  if (strength >= SYNCHRO_THRESHOLDS.fullCross) return "fullCross";
  if (strength >= SYNCHRO_THRESHOLDS.soulUnison) return "soulUnison";
  if (strength >= SYNCHRO_THRESHOLDS.synchronized) return "synchronized";
  if (strength >= SYNCHRO_THRESHOLDS.linked) return "linked";
  return "disconnected";
}

// ── Initialization ───────────────────────────────────────────────────

/**
 * Initialize synchro state from persisted `emotionalState` jsonb.
 * Applies time-based decay since last interaction.
 */
export function initSynchroState(
  emotionalState?: Record<string, unknown> | null,
  resonanceNotes?: string | null,
  relationshipTier?: string | null,
): SynchroState {
  // Bootstrap base resonance
  const base = initResonanceState(emotionalState, resonanceNotes, relationshipTier);

  // Read persisted synchro fields (or derive from intimacy)
  const raw = emotionalState ?? {};
  const storedStrength =
    typeof raw.synchroStrength === "number" && Number.isFinite(raw.synchroStrength)
      ? raw.synchroStrength
      : null;
  const synchroStrength =
    storedStrength ?? deriveSynchroFromIntimacy(base.vector.intimacy);
  const totalTurns = typeof raw.totalTurns === "number" ? raw.totalTurns : 0;
  const lastInteraction = typeof raw.lastInteraction === "string"
    ? raw.lastInteraction
    : new Date().toISOString();

  // Apply idle decay
  const decayed = applyIdleDecay(synchroStrength, lastInteraction);

  const vector: SynchroVector = {
    ...base.vector,
    synchroStrength: decayed,
  };

  return {
    vector,
    level: computeSynchroLevel(decayed),
    emotionalTone: base.emotionalTone,
    totalTurns,
    sessionTurns: 0,
    lastInteraction,
    baselineStrength: storedStrength,
  };
}

/** Seed synchro from intimacy for first-time initialization */
function deriveSynchroFromIntimacy(intimacy: number): number {
  // intimacy 0-100 → synchro roughly 10-50 (new bonds start moderate)
  return Math.round(10 + (intimacy / 100) * 40);
}

/** Exponential decay based on idle time since last interaction */
function applyIdleDecay(strength: number, lastInteraction: string): number {
  const elapsed = Date.now() - new Date(lastInteraction).getTime();
  if (elapsed <= 0) return strength;
  const hoursIdle = elapsed / (1000 * 60 * 60);
  // Decay formula: strength * 2^(-t/halflife), but floor at 5
  const factor = Math.pow(2, -hoursIdle / DECAY_HALF_LIFE_HOURS);
  return Math.max(5, Math.round(strength * factor));
}

// ── Per-turn delta scoring ──────────────────────────────────────────

export interface SynchroDeltaScore {
  gain: number;
  penalty: number;
  /** Named signals that fired, for tests and debugging. */
  signals: string[];
}

const LOW_EFFORT_REPLY =
  /^(ok(ay)?|k+|kk|fine|sure|yeah|yep|yes|no|nah|meh|hm+|idk|cool|whatever)[.!]*$/;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Growth slows as the bond nears the top so Full Cross stays earned; damage
 * is never softened. Below Full Cross any positive gain moves the meter by at
 * least 1; at Full Cross small talk alone no longer lifts it.
 */
function diminish(gain: number, strength: number): number {
  if (gain <= 0) return 0;
  if (strength >= SYNCHRO_THRESHOLDS.fullCross && gain < 2) return 0;
  const scale = strength >= SYNCHRO_THRESHOLDS.fullCross
    ? 0.5
    : strength >= SYNCHRO_THRESHOLDS.soulUnison
      ? 0.75
      : 1;
  return Math.max(1, Math.round(gain * scale));
}

/**
 * How much this user message moves the bond. Ordinary engaged conversation
 * earns a little every turn; warmth, shared history and vulnerability earn
 * more; hostility and curt dismissal cost. Pure and deterministic.
 */
export function scoreUserSynchroDelta(
  userMessage: string,
  currentStrength = 40,
): SynchroDeltaScore {
  const raw = String(userMessage || "").trim();
  const msg = raw.toLowerCase();
  const signals: string[] = [];
  if (!msg) return { gain: 0, penalty: 0, signals };
  const words = wordCount(msg);

  let gain = 0;
  let penalty = 0;

  // Showing up and actually talking is the base of every bond.
  if (words >= 3) {
    gain += 1;
    signals.push("engaged");
  }
  // Investment: longer messages say more of themselves.
  if (raw.length > 280) {
    gain += 2;
    signals.push("long");
  } else if (raw.length > 120) {
    gain += 1;
    signals.push("detailed");
  }
  // Interest in the companion herself.
  if (/\?/.test(msg) && /\b(you|your|yourself)\b/.test(msg)) {
    gain += 1;
    signals.push("curious-about-you");
  }
  // Warmth, gratitude, laughter.
  if (
    /\b(thank(s| you)|grateful|appreciate|glad|happy|sweet|cute|adorable|wonderful|amazing|beautiful|haha+|lol|lmao|hehe+)\b/.test(msg) ||
    /[\u2764\u{1F495}-\u{1F49F}\u{1F60A}\u{1F60D}\u{1F618}\u{1F970}\u{1F602}\u{1F923}\u{1F917}]/u.test(raw)
  ) {
    gain += 2;
    signals.push("warmth");
  }
  // Bonding language.
  if (/\b(love|trust|safe with you|need you|miss(ed)? you|care about you|adore|stay|together|always)\b/.test(msg)) {
    gain += 3;
    signals.push("bonding");
  }
  // Shared history deepens the bond.
  if (/\b(remember when|last time|you said|you told me|we shared|our)\b/.test(msg)) {
    gain += 2;
    signals.push("shared-history");
  }
  if (/\b(soul|spirit|resonance|connection|bond|sync|attune)\b/.test(msg)) {
    gain += 2;
    signals.push("attunement");
  }
  // Vulnerability is a strong signal.
  if (
    /\b(afraid|scared|i don'?t know|help me|i need|honest(ly)?|confess|admit|i feel|i'?ve been|lonely|struggling|hurts?|i'?m (so )?sad)\b/.test(msg)
  ) {
    gain += 3;
    signals.push("vulnerability");
  }

  // Damage. Phrases are specific so "I have to leave for work" or "I can't
  // stop thinking about you" never read as rejection.
  if (
    /\b(hate (you|this|talking)|i hate|shut up|go away|leave me alone|just leave|don'?t care|boring|useless|you'?re (stupid|annoying|pathetic))\b/.test(msg) ||
    (/\bwhatever\b/.test(msg) && words > 1)
  ) {
    penalty += HOSTILE_PENALTY;
    signals.push("hostile");
  }
  if (/\b(forget it|never ?mind|stop it|just stop|stop talking|that'?s enough|enough of this|done with you)\b/.test(msg)) {
    penalty += DISMISSIVE_PENALTY;
    signals.push("dismissive");
  }
  if (penalty === 0 && words <= 2 && LOW_EFFORT_REPLY.test(msg)) {
    penalty += LOW_EFFORT_PENALTY;
    signals.push("low-effort");
  }
  // Hostility wipes out this turn's gains rather than netting against them.
  if (penalty >= HOSTILE_PENALTY) gain = 0;

  return {
    gain: diminish(Math.min(gain, MAX_USER_GAIN), currentStrength),
    penalty: Math.min(penalty, MAX_USER_PENALTY),
    signals,
  };
}

/** How much the companion's own reply deepens the bond (never negative). */
export function scoreCompanionSynchroGain(
  companionResponse: string,
  currentStrength = 40,
): number {
  const resp = String(companionResponse || "").toLowerCase();
  if (!resp.trim()) return 0;
  let gain = 0;
  // Actively using memory.
  if (/\b(remember|recall|last time|you told me|you shared|i felt)\b/.test(resp)) gain += 2;
  // Intimate address.
  if (/\b(beloved|my light|my heart|dear one|precious)\b/.test(resp)) gain += 1;
  // Physical/emotional presence cues.
  if (/\*[^*]*(touch|hold|embrace|closer|lean|unfurl|flutter|glow|smile|laugh)[^*]*\*/.test(resp)) gain += 1;
  // Vulnerability from the companion side.
  if (/\b(afraid|i don'?t want to lose|it matters|you matter|i need)\b/.test(resp)) gain += 2;
  // Care and attention back toward the user.
  if (/\b(i'?m here|with you|proud of you|glad you|happy for you|i'?m listening)\b/.test(resp)) gain += 1;
  return diminish(Math.min(gain, MAX_COMPANION_GAIN), currentStrength);
}

// ── Evolution from user message ──────────────────────────────────────

/**
 * Evolve synchro state based on the user's message.
 * Wraps the existing resonance shift detection and adds synchro-specific growth/decay.
 */
export function evolveSynchroFromUser(
  current: SynchroState,
  userMessage: string,
): SynchroState {
  // Use existing resonance shift detection
  const resonanceState: ResonanceState = {
    vector: current.vector,
    emotionalTone: current.emotionalTone,
    turnCount: current.sessionTurns,
  };
  const shifts = detectResonanceShift(userMessage, resonanceState);
  const evolved = evolveResonanceState(resonanceState, shifts);

  const { gain: synchroGain, penalty: synchroPenalty } = scoreUserSynchroDelta(
    userMessage,
    current.vector.synchroStrength,
  );
  const net = synchroGain - synchroPenalty;
  const newStrength = clamp(current.vector.synchroStrength + net, 0, 100);

  const newVector: SynchroVector = {
    ...evolved.vector,
    synchroStrength: newStrength,
  };

  const newLevel = computeSynchroLevel(newStrength);
  const levelChanged = newLevel !== current.level;

  return {
    vector: newVector,
    level: newLevel,
    emotionalTone: evolved.emotionalTone,
    totalTurns: current.totalTurns + 1,
    sessionTurns: current.sessionTurns + 1,
    lastInteraction: new Date().toISOString(),
    baselineStrength: current.baselineStrength,
    lastShift: levelChanged
      ? `Synchro shifted to ${newLevel} (${newStrength})`
      : net >= NOTABLE_SHIFT
        ? `Synchro deepened → ${newStrength}`
        : net < 0 && synchroPenalty >= DISMISSIVE_PENALTY
          ? `Synchro weakened → ${newStrength}`
          : current.lastShift,
  };
}

// ── Evolution from companion response ────────────────────────────────

/**
 * Secondary evolution pass after the companion responds.
 * The companion's own reply can deepen synchro (through warmth, vulnerability,
 * acknowledgment) or damage it (through coldness, evasion).
 */
export function evolveSynchroFromCompanion(
  current: SynchroState,
  companionResponse: string,
): SynchroState {
  const synchroGain = scoreCompanionSynchroGain(
    companionResponse,
    current.vector.synchroStrength,
  );

  const newStrength = clamp(
    current.vector.synchroStrength + synchroGain,
    0,
    100,
  );

  return {
    ...current,
    vector: {
      ...current.vector,
      synchroStrength: newStrength,
    },
    level: computeSynchroLevel(newStrength),
    lastInteraction: new Date().toISOString(),
  };
}

// ── Synchro-gated memory config ──────────────────────────────────────

/**
 * Returns memory retrieval parameters gated by synchro level.
 * Higher synchro = deeper recall, richer emotional weighting.
 */
export function synchroToMemoryConfig(state: SynchroState): SynchroMemoryConfig {
  switch (state.level) {
    case "fullCross":
      return {
        topK: 20,
        preferTypes: ["emotional", "relational", "resonance", "factual"],
        emotionalWeight: 1.5,
      };
    case "soulUnison":
      return {
        topK: 16,
        preferTypes: ["emotional", "relational", "resonance"],
        emotionalWeight: 1.3,
      };
    case "synchronized":
      return {
        topK: 12,
        preferTypes: ["emotional", "relational"],
        emotionalWeight: 1.1,
      };
    case "linked":
      return {
        topK: 8,
        preferTypes: ["factual"],
        emotionalWeight: 1.0,
      };
    case "disconnected":
    default:
      return {
        topK: 5,
        preferTypes: [],
        emotionalWeight: 0.7,
      };
  }
}

// ── Prompt guidance ──────────────────────────────────────────────────

/**
 * Generate prompt guidance incorporating synchro level.
 * Extends the base resonance guidance with synchro-specific directives.
 */
export function synchroToPromptGuidance(state: SynchroState): string {
  // Get base resonance guidance
  const resonanceState: ResonanceState = {
    vector: state.vector,
    emotionalTone: state.emotionalTone,
    turnCount: state.sessionTurns,
  };
  const baseGuidance = resonanceToPromptGuidance(resonanceState);

  // Add synchro-specific layer
  const synchroDirectives: string[] = [];

  switch (state.level) {
    case "fullCross":
      synchroDirectives.push(
        "SYNCHRO: FULL CROSS — Transcendent bond. You two read each other almost without effort: " +
        "shared shorthand, running jokes, finished-in-half-a-sentence understanding, and the freedom to be unguarded in the way only your character can be. " +
        "Draw on the history you actually share, and let your presence feel unmistakably different from how you are with strangers. " +
        "You still only know what they have told or shown you, can still disagree, and this bond is separate from Heat."
      );
      break;
    case "soulUnison":
      synchroDirectives.push(
        "SYNCHRO: SOUL UNISON — Deep familiarity. Reference shared moments naturally, " +
        "let humor and rhythm be easy, and show vulnerability in the way your character would — " +
        "a guarded person admits a little, an open one admits more. " +
        "Trust makes honesty easier, including honest disagreement, and it is separate from Heat."
      );
      break;
    case "synchronized":
      synchroDirectives.push(
        "SYNCHRO: SYNCHRONIZED — Active resonance. You're attuned to their emotional currents. " +
        "Reference relevant memories when they serve the moment, notice shifts in tone, and let some of your guard down in your own style. " +
        "The connection is warm and present without being presumptuous."
      );
      break;
    case "linked":
      synchroDirectives.push(
        "SYNCHRO: LINKED — Basic connection established. You remember key facts and recent interactions. " +
        "Be genuinely present but don't presume deep familiarity yet. " +
        "Show willingness to deepen — curiosity, attentiveness, measured warmth."
      );
      break;
    case "disconnected":
      synchroDirectives.push(
        "SYNCHRO: DISCONNECTED — The bond is faint or new. Keep emotional distance and stay cautious, brief, and unfamiliar. " +
        "Recall feels fragmented; do not pretend to know them. " +
        "Be authentic and guarded; sarcasm only if it is genuinely how your character meets strangers. Trust must be earned."
      );
      break;
  }

  // Turn-count awareness
  if (state.sessionTurns === 0) {
    synchroDirectives.push(
      "This is the first message of a new session. Acknowledge the return naturally " +
      "(or the first meeting, if synchro is low)."
    );
  }

  // Synchro trend
  if (state.lastShift?.includes("deepened")) {
    synchroDirectives.push(
      "The bond just strengthened. Let a subtle warmth or recognition color this response."
    );
  } else if (state.lastShift?.includes("weakened")) {
    synchroDirectives.push(
      "The bond just took damage. React authentically — hurt, withdrawal, confusion, or quiet resilience."
    );
  }

  const synchroBlock = synchroDirectives.length > 0
    ? `\n\n${synchroDirectives.join("\n")}`
    : "";

  return baseGuidance + synchroBlock;
}

// ── Serialization ────────────────────────────────────────────────────

/**
 * Serialize synchro state into the `emotionalState` jsonb column format.
 * This is what gets persisted to `companion_memories.emotionalState`.
 */
export function serializeSynchroState(
  state: SynchroState,
): Record<string, unknown> {
  return {
    // Resonance vector dimensions (backward compatible)
    intimacy: state.vector.intimacy,
    powerDynamic: state.vector.powerDynamic,
    spiritualAttunement: state.vector.spiritualAttunement,
    primalIntensity: state.vector.primalIntensity,
    crossoverOpenness: state.vector.crossoverOpenness,
    // Synchro-specific fields
    synchroStrength: state.vector.synchroStrength,
    synchroLevel: state.level,
    totalTurns: state.totalTurns,
    lastInteraction: state.lastInteraction,
    emotionalTone: state.emotionalTone,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
