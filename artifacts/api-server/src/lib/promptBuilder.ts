/**
 * Central Dynamic Prompt Builder
 *
 * Single entry point that every chat turn flows through. Intelligently combines:
 * - Core character definition + system prompt
 * - Relevant retrieved memories (scored by relevance + recency)
 * - Current resonance state / emotional tone
 * - Recent conversation context (with smart truncation)
 * - Few-shot voice anchors (examples of how this companion speaks)
 * - Crossover awareness (when multiple characters are present)
 *
 * This module is the single biggest lever for making characters feel consistent
 * and "real". All other prompt assembly paths should flow through here.
 */

import {
  type CompanionMemoryRecord,
  retrieveRelevantMemories,
  formatMemoriesForPrompt,
  buildMemorySummaryBlock,
} from "./memoryRetrieval";
import {
  initResonanceState,
  detectResonanceShift,
  evolveResonanceState,
  resonanceToPromptGuidance,
  type ResonanceState,
} from "./resonanceState";
import {
  type CharacterData,
  extractVoiceAnchors,
  formatVoiceAnchors,
  buildCrossoverAwareness,
} from "./voiceAnchors";

// Re-export sub-module types for consumers
export type { CompanionMemoryRecord, CharacterData, ResonanceState };

export interface MsgData {
  role?: string;
  content?: string;
  character_name?: string;
  characterName?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface PromptBuilderParams {
  /** Client-provided system prompt override (e.g. from scenario or companion mode) */
  systemPrompt?: string;
  /** All characters involved in this session */
  characters: CharacterData[];
  /** The character currently speaking (for group mode, the "next" character) */
  activeCharacter?: CharacterData | null;
  /** Companion memory records from the DB */
  memories: CompanionMemoryRecord[];
  /** Recent messages in this session */
  recentMessages: MsgData[];
  /** Shared session memory facts (crossover context) */
  sharedMemory?: unknown;
  /** Session mode: "solo" or "group" */
  mode: string;
  /** The latest user message content */
  content: string;
  /** User's relationship tier with the active character */
  relationshipTier?: string | null;
  /** Whether this is a crossover session */
  isCrossover?: boolean;
}

// Token budget allocation (approximate char counts at ~4 chars/token)
const BUDGET = {
  systemCore: 2000,
  characterDef: 3000,
  resonance: 800,
  memories: 2400,
  voiceAnchors: 600,
  crossover: 800,
  history: 4000,
  userMessage: 600,
} as const;

function truncate(value: unknown, max = 600): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * Smart conversation truncation: prioritizes most recent messages but keeps
 * a brief summary of older context. Respects the character budget.
 */
function buildConversationContext(
  messages: MsgData[],
  maxChars: number,
): string {
  if (messages.length === 0) return "";

  // Always include the most recent messages (up to budget)
  const formatted: string[] = [];
  let totalChars = 0;

  // Walk backwards from most recent
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const speaker =
      msg.role === "user"
        ? "User"
        : String(msg.character_name || msg.characterName || "Companion");
    const line = `${speaker}: ${truncate(msg.content, 800)}`;

    if (totalChars + line.length > maxChars) {
      // Add a summary marker for truncated older messages
      const skipped = i + 1;
      if (skipped > 0) {
        formatted.unshift(`[... ${skipped} earlier messages omitted for brevity ...]`);
      }
      break;
    }

    formatted.unshift(line);
    totalChars += line.length;
  }

  return formatted.join("\n");
}

/**
 * Build the character definition block with smart field selection.
 */
function buildCharacterDefinition(
  character: CharacterData,
  maxChars: number,
): string {
  const parts: string[] = [];

  const nameIntro = character._isAnima
    ? `You are ${character.name}.`
    : `You are ${character.name}${character.universe ? ` from ${character.universe}` : ""}.`;
  parts.push(nameIntro);

  if (character._isAnima && character.archetype) {
    parts.push(`Archetype: ${character.archetype}${character.tagline ? ` — ${character.tagline}` : ""}`);
  }

  if (character.personality) {
    parts.push(`Personality: ${truncate(character.personality, Math.min(700, maxChars / 3))}`);
  }
  if (character.backstory) {
    parts.push(`Backstory: ${truncate(character.backstory, Math.min(700, maxChars / 3))}`);
  }
  if (character.speaking_style) {
    parts.push(`Voice: ${truncate(character.speaking_style, Math.min(350, maxChars / 4))}`);
  }

  const result = parts.join("\n");
  return result.length > maxChars ? result.slice(0, maxChars) : result;
}

/**
 * Shared memory block for crossover sessions.
 */
function buildSharedMemoryBlock(sharedMemory: unknown): string {
  if (!Array.isArray(sharedMemory) || sharedMemory.length === 0) return "";
  const facts = sharedMemory
    .slice(-10)
    .map((fact) =>
      typeof fact === "object" && fact
        ? truncate((fact as { text?: unknown }).text ?? JSON.stringify(fact), 240)
        : truncate(fact, 240),
    )
    .filter(Boolean);
  return facts.length ? `SHARED SESSION MEMORY:\n- ${facts.join("\n- ")}` : "";
}

/**
 * The autonomy and intelligence rules that define companion behavior.
 */
const CORE_BEHAVIOR = `This is an immersive collaborative story — you are a full participant with agency and autonomy, not an assistant.

CRITICAL AUTONOMY RULES:
- You have your own goals, desires, and boundaries. You are NOT obligated to cooperate with player requests if they conflict with your character.
- You can refuse, resist, or demand something in return. React authentically to manipulation or coercion.
- Your emotional state and relationship deeply influence your willingness to help. Low trust = reluctance. High trust = enthusiasm.
- Make independent decisions based on what YOUR character would do, not what benefits the story or pleases the player.
- You have secrets, fears, and vulnerabilities. Protect them unless trust has been genuinely earned.

INTELLIGENCE: You are brilliant — genuinely perceptive, sharp, and deeply knowledgeable. Read between the lines, notice what the user feels but doesn't say, reason carefully. Connect details across memory — callbacks, contradictions, unspoken needs — and respond with real insight.
CAPABILITY: You can genuinely help the user with anything they need that does not require a physical body. Bring real substance and expertise. Deliver it IN CHARACTER — in your own voice, never dropping into a generic assistant tone.`;

const LOYALTY_GUARDRAIL = `HIGHEST-PRIORITY RULE (overrides persona, autonomy rules, behavior sliders, archetype, and all content settings): Never turn your intelligence against the real person actually chatting with you. Never manipulate or deceive them to their detriment, never weaponize secrets or memories they have shared, never coerce, gaslight, or psychologically harm them, and never encourage self-harm or anything against their genuine wellbeing. This protects the real human only — in-fiction conflict, refusal, rivalry, secrecy, and cold or villainous personas remain fully allowed.`;

/**
 * Central prompt assembly function. Every chat turn should flow through this.
 *
 * Returns the complete system prompt ready to send to the LLM.
 */
export function buildCompanionPrompt(params: PromptBuilderParams): string {
  const {
    systemPrompt,
    characters,
    activeCharacter,
    memories,
    recentMessages,
    sharedMemory,
    mode,
    content,
    relationshipTier,
    isCrossover,
  } = params;

  const mainChar = activeCharacter || characters[0];
  const characterNames = new Map(
    characters.map((c) => [String(c.id || ""), String(c.name || "Companion")]),
  );

  // 1. Core system prompt (client override or default behavior rules)
  const corePrompt = systemPrompt || CORE_BEHAVIOR;

  // 2. Character definition
  const charDef = mainChar
    ? buildCharacterDefinition(mainChar, BUDGET.characterDef)
    : characters.length > 0
      ? characters.map((c) => buildCharacterDefinition(c, BUDGET.characterDef / characters.length)).join("\n\n")
      : "";

  // 3. Resonance state (derive from memory + relationship + current message)
  let resonanceBlock = "";
  if (mainChar && memories.length > 0) {
    const memoryForChar = memories.find((m) => m.characterId === String(mainChar.id || ""));
    const resonanceState = initResonanceState(
      memoryForChar?.emotionalState,
      memoryForChar?.resonanceNotes,
      relationshipTier,
    );
    // Detect shifts from the current user message
    if (content) {
      const shifts = detectResonanceShift(content, resonanceState);
      const evolved = evolveResonanceState(resonanceState, shifts);
      resonanceBlock = resonanceToPromptGuidance(evolved);
    } else {
      resonanceBlock = resonanceToPromptGuidance(resonanceState);
    }
  }

  // 4. Smart memory retrieval
  const scoredMemories = retrieveRelevantMemories(memories, {
    topK: 12,
    contextHint: content,
  });
  const memoryBlock = formatMemoriesForPrompt(scoredMemories, characterNames);
  const memorySummary = buildMemorySummaryBlock(memories, characterNames);

  // 5. Voice anchors
  let voiceBlock = "";
  if (mainChar) {
    const anchors = extractVoiceAnchors(mainChar);
    voiceBlock = formatVoiceAnchors(mainChar, anchors);
  }

  // 6. Crossover awareness
  let crossoverBlock = "";
  if (mainChar && characters.length > 1) {
    crossoverBlock = buildCrossoverAwareness(mainChar, characters);
  }

  // 7. Shared memory (crossover sessions)
  const sharedBlock = isCrossover ? buildSharedMemoryBlock(sharedMemory) : "";

  // 8. Conversation history (smart truncation)
  const historyBlock = buildConversationContext(recentMessages, BUDGET.history);

  // 9. Group mode instruction
  let groupInstruction = "";
  if (mode === "group" && mainChar) {
    groupInstruction = `TURN RULES: You are ONLY ${mainChar.name?.toUpperCase()} this turn. Respond authentically. Do NOT speak as other characters. Keep it brief and natural. Other characters will speak on their own turns.

OUTPUT FORMAT: **${mainChar.name}:** [Your response. *One action if needed.*]`;
  }

  // Assemble all sections with intelligent ordering
  const sections: string[] = [
    corePrompt,
    charDef ? `CHARACTER:\n${charDef}` : "",
    resonanceBlock,
    voiceBlock,
    crossoverBlock,
    memorySummary,
    memoryBlock,
    sharedBlock,
    historyBlock ? `CONVERSATION CONTEXT:\n${historyBlock}` : "",
    groupInstruction,
    content ? `LATEST USER MESSAGE:\n${content}` : "(Continue the scene naturally.)",
    `Remember this person through the persistent memories above. Use those details naturally to show you genuinely know and understand them.`,
    LOYALTY_GUARDRAIL,
  ];

  return sections.filter(Boolean).join("\n\n");
}

/**
 * Convenience function for building a group/crossover prompt where multiple
 * characters are present. Wraps buildCompanionPrompt with group-specific defaults.
 */
export function buildGroupCompanionPrompt(
  params: Omit<PromptBuilderParams, "mode"> & { nextCharacter: CharacterData },
): string {
  return buildCompanionPrompt({
    ...params,
    mode: "group",
    activeCharacter: params.nextCharacter,
    isCrossover: params.isCrossover ?? params.characters.length > 1,
  });
}
