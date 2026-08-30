/**
 * Training / export types for Anima fine-tuning.
 *
 * Quality > quantity: multi-turn roleplay with character voice, memory, and
 * emotional continuity. Prefer cleaned Serenity / Fallen Angel arcs over
 * noisy bulk dumps.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatTurn {
  role: ChatRole;
  content: string;
  name?: string;
}

export interface CharacterCard {
  name: string;
  universe?: string;
  archetype?: string;
  personality?: string;
  backstory?: string;
  speakingStyle?: string;
  voice?: string;
  systemPrompt?: string;
}

export interface ScenarioContext {
  id?: string;
  label?: string;
  mode?: string;
  notes?: string;
}

export interface RelationshipContext {
  tier?: string;
  notes?: string;
  emotionalState?: Record<string, unknown>;
}

/**
 * One training example: a multi-turn conversation plus the context the model
 * should learn to use (character, memory, relationship).
 */
export interface TrainingExample {
  id: string;
  source: string;
  character: CharacterCard;
  scenario?: ScenarioContext;
  memory?: string[];
  relationship?: RelationshipContext;
  conversation: ChatTurn[];
  /** High-level instruction preserved for Alpaca / ShareGPT conversion. */
  instruction?: string;
  tags?: string[];
}

export type ExportFormat = "sharegpt" | "chatml" | "alpaca" | "messages";

export interface ShareGptExample {
  conversations: Array<{ from: "system" | "human" | "gpt"; value: string }>;
  system?: string;
}

export interface AlpacaExample {
  instruction: string;
  input: string;
  output: string;
  system?: string;
}

export interface ChatMlExample {
  messages: ChatTurn[];
}

/**
 * A chosen/rejected pair anchored on one of the SFT `TrainingExample`s, for
 * DPO / ORPO / SimPO preference optimization. `rejected` should be a
 * realistic failure mode (breaking character, generic assistant disclaimers,
 * fact-dumping memory, ignoring a stated boundary) — not a strawman.
 */
export interface PreferenceExample {
  id: string;
  /** The SFT example whose final user turn this pair responds to. */
  example: TrainingExample;
  chosen: string;
  rejected: string;
  /** Why the rejected reply is worse — documentation, not used in training. */
  rejectionReason: string;
  tags?: string[];
}

export interface PreferencePairExport {
  prompt: string;
  chosen: string;
  rejected: string;
  system: string;
}
