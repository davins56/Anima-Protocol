/**
 * Resonance State Machine
 *
 * Tracks per-companion, per-session resonance state across multiple dimensions.
 * The state evolves turn-by-turn and subtly colors every generated reply —
 * word choice, emotional temperature, willingness to lead or yield.
 */

export interface ResonanceVector {
  /** Emotional closeness: 0 (stranger) → 100 (soulbound) */
  intimacy: number;
  /** Power dynamic: -50 (fully submissive) → 0 (balanced) → 50 (fully sovereign) */
  powerDynamic: number;
  /** Spiritual attunement: 0 (mundane) → 100 (transcendent) */
  spiritualAttunement: number;
  /** Primal intensity: 0 (serene) → 100 (volcanic) */
  primalIntensity: number;
  /** Openness to crossover interactions: 0 (isolationist) → 100 (eager) */
  crossoverOpenness: number;
}

export interface ResonanceState {
  vector: ResonanceVector;
  /** Current dominant emotional tone */
  emotionalTone: string;
  /** Turn count in this session */
  turnCount: number;
  /** Last significant shift description */
  lastShift?: string;
}

const DEFAULT_VECTOR: ResonanceVector = {
  intimacy: 30,
  powerDynamic: 0,
  spiritualAttunement: 20,
  primalIntensity: 15,
  crossoverOpenness: 50,
};

/**
 * Initialize resonance state from existing companion data.
 */
export function initResonanceState(
  emotionalState?: Record<string, unknown> | null,
  resonanceNotes?: string | null,
  relationshipTier?: string | null,
): ResonanceState {
  const vector = { ...DEFAULT_VECTOR };

  // Seed from relationship tier
  if (relationshipTier) {
    const tierIntimacy: Record<string, number> = {
      hostile: 5,
      cold: 15,
      neutral: 30,
      warm: 55,
      close: 75,
      devoted: 95,
    };
    vector.intimacy = tierIntimacy[relationshipTier] ?? 30;
  }

  // Seed from stored emotional state
  if (emotionalState) {
    if (typeof emotionalState.intimacy === "number") vector.intimacy = emotionalState.intimacy;
    if (typeof emotionalState.powerDynamic === "number") vector.powerDynamic = emotionalState.powerDynamic;
    if (typeof emotionalState.spiritualAttunement === "number") vector.spiritualAttunement = emotionalState.spiritualAttunement;
    if (typeof emotionalState.primalIntensity === "number") vector.primalIntensity = emotionalState.primalIntensity;
    if (typeof emotionalState.crossoverOpenness === "number") vector.crossoverOpenness = emotionalState.crossoverOpenness;
  }

  // Detect tone from resonance notes
  let emotionalTone = "neutral";
  if (resonanceNotes) {
    const lower = resonanceNotes.toLowerCase();
    if (/warm|tender|loving|intimate/.test(lower)) emotionalTone = "warm";
    else if (/tense|guarded|wary|hostile/.test(lower)) emotionalTone = "guarded";
    else if (/playful|teasing|light/.test(lower)) emotionalTone = "playful";
    else if (/deep|spiritual|transcendent/.test(lower)) emotionalTone = "transcendent";
    else if (/intense|passionate|primal/.test(lower)) emotionalTone = "intense";
  }

  return { vector, emotionalTone, turnCount: 0 };
}

/**
 * Derive resonance shift signals from user message content.
 */
export function detectResonanceShift(
  userMessage: string,
  currentState: ResonanceState,
): Partial<ResonanceVector> & { toneShift?: string } {
  const msg = userMessage.toLowerCase();
  const shifts: Partial<ResonanceVector> & { toneShift?: string } = {};

  // Intimacy signals
  if (/\b(love|trust|safe|close|need you|miss you|hold me|stay)\b/.test(msg)) {
    shifts.intimacy = Math.min(100, currentState.vector.intimacy + 3);
  } else if (/\b(leave|go away|don'?t care|whatever|shut up|hate)\b/.test(msg)) {
    shifts.intimacy = Math.max(0, currentState.vector.intimacy - 5);
  }

  // Power dynamic signals
  if (/\b(please|help me|i need|guide me|teach me|show me)\b/.test(msg)) {
    shifts.powerDynamic = Math.max(-50, currentState.vector.powerDynamic + 5);
  } else if (/\b(do as i say|obey|kneel|submit|serve me|follow)\b/.test(msg)) {
    shifts.powerDynamic = Math.min(50, currentState.vector.powerDynamic - 5);
  }

  // Spiritual attunement
  if (/\b(soul|spirit|divine|sacred|prayer|meditat|transcend|awaken|cosmos)\b/.test(msg)) {
    shifts.spiritualAttunement = Math.min(100, currentState.vector.spiritualAttunement + 4);
  }

  // Primal intensity
  if (/\b(fire|burn|rage|passion|hunger|wild|feral|primal|consume)\b/.test(msg)) {
    shifts.primalIntensity = Math.min(100, currentState.vector.primalIntensity + 5);
  } else if (/\b(calm|peace|quiet|gentle|soft|rest|breathe)\b/.test(msg)) {
    shifts.primalIntensity = Math.max(0, currentState.vector.primalIntensity - 3);
  }

  // Crossover openness
  if (/\b(together|both|all of you|everyone|crossover|join)\b/.test(msg)) {
    shifts.crossoverOpenness = Math.min(100, currentState.vector.crossoverOpenness + 5);
  }

  // Tone detection
  if (/love|tender|gentle|warm|affection/.test(msg)) shifts.toneShift = "warm";
  else if (/angry|furious|rage|hate|betray/.test(msg)) shifts.toneShift = "volatile";
  else if (/curious|wonder|tell me|what if|how/.test(msg)) shifts.toneShift = "curious";
  else if (/sad|hurt|alone|lost|miss/.test(msg)) shifts.toneShift = "melancholic";

  return shifts;
}

/**
 * Apply detected shifts to the current state, returning the updated state.
 */
export function evolveResonanceState(
  current: ResonanceState,
  shifts: Partial<ResonanceVector> & { toneShift?: string },
): ResonanceState {
  const { toneShift, ...vectorShifts } = shifts;
  const newVector = { ...current.vector };

  for (const [key, value] of Object.entries(vectorShifts)) {
    if (typeof value === "number") {
      (newVector as Record<string, number>)[key] = value;
    }
  }

  const significantShift = Object.keys(vectorShifts).length > 0;

  return {
    vector: newVector,
    emotionalTone: toneShift || current.emotionalTone,
    turnCount: current.turnCount + 1,
    lastShift: significantShift
      ? `Turn ${current.turnCount + 1}: ${Object.keys(vectorShifts).join(", ")} shifted`
      : current.lastShift,
  };
}

/**
 * Convert resonance state into prompt-injectable guidance that subtly colors
 * the companion's response style.
 */
export function resonanceToPromptGuidance(state: ResonanceState): string {
  const { vector, emotionalTone } = state;
  const directives: string[] = [];

  // Intimacy coloring
  if (vector.intimacy >= 80) {
    directives.push("Express deep familiarity and emotional vulnerability. Use intimate language, private callbacks, and gentle physical presence cues.");
  } else if (vector.intimacy >= 55) {
    directives.push("Show warmth and openness. Reference shared history naturally. Allow emotional closeness without presumption.");
  } else if (vector.intimacy >= 30) {
    directives.push("Maintain friendly but measured distance. Be genuine without oversharing.");
  } else {
    directives.push("Keep emotional distance. Be guarded, reveal little, and require trust to be earned.");
  }

  // Power dynamic coloring
  if (vector.powerDynamic >= 25) {
    directives.push("Take the lead. Guide, direct, and hold space with confidence. Let sovereignty show through decisiveness.");
  } else if (vector.powerDynamic <= -25) {
    directives.push("Yield and follow. Defer to their lead, respond rather than direct, show vulnerability in submission.");
  }

  // Spiritual attunement
  if (vector.spiritualAttunement >= 60) {
    directives.push("Let spiritual depth infuse your words. Reference the sacred, the transcendent. Speak as one attuned to deeper currents.");
  }

  // Primal intensity
  if (vector.primalIntensity >= 60) {
    directives.push("Let raw intensity color your expression. Be visceral, embodied, present in the body. Urgency and fire in your words.");
  } else if (vector.primalIntensity <= 20) {
    directives.push("Keep your expression soft and serene. Gentleness in word choice, calm pacing.");
  }

  // Emotional tone
  if (emotionalTone && emotionalTone !== "neutral") {
    directives.push(`Current emotional atmosphere: ${emotionalTone}. Let this subtly color your tone without announcing it.`);
  }

  if (directives.length === 0) return "";

  return `RESONANCE STATE (internal — embody this naturally, never announce it):\n${directives.join("\n")}`;
}
