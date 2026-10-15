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
import { messageTurnId } from "./replyReplacement";
import {
  initResonanceState,
  detectResonanceShift,
  evolveResonanceState,
  resonanceToPromptGuidance,
  type ResonanceState,
} from "./
resonanceState";
import {
  type SynchroState,
  synchroToMemoryConfig,
  synchroToPromptGuidance,
} from "./
synchroEngine";
import {
  type CompanionAffect,
  companionAffectToPromptGuidance,
} from "./
companionAffect";
import type { RelationshipState } from "./
relationshipEngine";
import type { ArcState } from "./
arrativeArcEngine";
import { relationshipStateToPrompt, arcStateToPrompt } from "./
arcAndBondPrompt";
import { formatExpressionPrompt } from "./
animaExpressions";
import {
  hiddenSequencePromptBlock,
  type HiddenSequencesState,
  type Weather,
} from "./
hiddenSequences";
import { appendPdfAfterContext, capPdfPromptBlock, fitPdfToRoom } from "./
pdf/context";
import { OLLAMA_NUM_PREDICT_CAP } from "./
ollamaChat";

import {
  type CharacterData,
  extractVoiceAnchors,
  formatVoiceAnchors,
  buildCrossoverAwareness,
} from "./
voiceAnchors";
import {
  promptHasRegionalWorldKnowledge,
  upsertRegionalWorldKnowledge,
} from "./
regionalWorldKnowledge";
import {
  modePolicyPrompt,
  resolveChatModePolicy,
  type ChatModePolicy,
} from "./
chatModeRegistry";
import {
  COMPANION_CRISIS_TURN_LINE,
  crisisResourceForCountry,
  isLlmExcludedDisclosure,
  therapySafetyPrompt,
  type CrisisResource,
  type TherapySafetyAssessment,
} from "./
therapySafety";
import type { IntimacyProfile, IntimacyScene, IntimacyTurnResult } from "./
intimacyTypes";
import { getIntimacyPromptGuidance } from "./
intimacyPrompt";
import {
  formatOperatorModelForPrompt,
  type OperatorModel,
} from "./
operatorModel";

// Re-export sub-module types for consumers
export type { CompanionMemoryRecord, CharacterData, ResonanceState, SynchroState };

export interface MsgData {
  role?: string | null;
  content?: string | null;
  character_name?: string | null;
  characterName?: string | null;
  timestamp?: string | null;
  [key: string]: unknown;
}

export interface PromptBuilderParams {
  /**
   * Legacy client-provided scene context. It is input to, never an override of,
   * the server-owned identity, mode, safety, memory, and turn-taking policies.
   */
  systemPrompt?: string;
  clientContext?: string;

  /** Persistent relationship/bond state (relationship engine, A) */
  relationshipState?: RelationshipState | null;

  /** Persistent narrative arc state (narrative engine, B) */
  arcState?: ArcState | null;

  /**
   * Optional milestone-based personality evolution delta.
   * Produced by evolutionEngine and injected into the system prompt.
   */
  evolutionDelta?: {
    version: number;
    appliedAt: string;
    milestone: number;
    traitsDelta: Record<string, unknown>;
    quirkAdditions: string[];
    voidBias?: number;
  };

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
  /**
   * Signed-in display name. Used only by the answer-last instruction.
   * When empty, the operator-model identity name is the next fallback.
   */
  userDisplayName?: string | null;
  /** User's relationship tier with the active character */
  relationshipTier?: string | null;
  /** Whether this is a crossover session */
  isCrossover?: boolean;
  /** Enable the companion's unfiltered *tone* override (style only). */
  uncensoredMode?: boolean;
  /** Pre-computed synchro state (if provided, overrides internal resonance init) */
  synchroState?: SynchroState | null;
  /**
   * Companion-owned felt state (Kernel self-state). Injected as a short
   * SELF-STATE line after resonance — never a mood menu.
   */
  companionAffect?: CompanionAffect | null;

  /**
   * Live regional world-knowledge block (local time, weather, holidays).
   * Injected for Anima and character-list entities so they can speak from
   * the user's real-world region instead of only their fiction.
   */
  worldKnowledge?: string | null;
  /** Declarative server-owned mode contract for this turn. */
  modePolicy?: ChatModePolicy;
  /** Layered therapy risk result; only used by the therapy mode contract. */
  therapyAssessment?: TherapySafetyAssessment | null;
  crisisResource?: CrisisResource | null;
  /**
   * This user message expressed suicidal thoughts or self-harm.
   * Adds a per-turn care line. It does not change the stable prefix.
   */
  companionCrisis?: boolean;

  /** Hidden Sequences / conversational weather (client-authored, sanitized as guidance). */
  hiddenSequences?: HiddenSequencesState | null;
  conversationalWeather?: Weather | null;

  /** Intimacy profile, scene, and turn evaluation result */
  intimacyProfile?: IntimacyProfile | null;
  intimacyScene?: IntimacyScene | null;
  intimacyTurnResult?: IntimacyTurnResult | null;

  /**
   * Steward / operator Hub-DNA analogue. Injected after identity lock as
   * bounded context — never an override of CHARACTER IDENTITY LOCK or memories.
   */
  operatorModel?: OperatorModel | null;

  /**
   * Optional repository RAG block. Kept out of the client-scene wrap so a fat
   * Chat.jsx systemPrompt cannot crowd it out — and so ordinary turns can skip it.
   */
  repositoryKnowledge?: string | null;

  /**
   * Excerpts from PDFs the user shared in this chat or saved as companion
   * lore. Appended after persona, mood, and memory, then trimmed to
   * PDF_CONTEXT_WORD_BUDGET and whatever room remains in
   * PROMPT_CONTEXT_CHAR_BUDGET.
   */
  pdfContext?: string | null;

  /**
   * Characters already reserved outside this string (replayed history and
   * the user turn). They count against PROMPT_CONTEXT_CHAR_BUDGET so PDF
   * text cannot push that history out.
   */
  contextReservedChars?: number;

  /**
   * When true, skip CONVERSATION CONTEXT and LATEST USER MESSAGE. Pair with
   * `buildLlmChatMessages` so history is sent once as chat turns instead of
   * being inlined here and replayed (double prefill toward num_ctx 8192).
   */
  omitConversationHistory?: boolean;
}

// Token budget allocation (approximate char counts at ~4 chars/token).
// These caps already bound persona, mood/resonance, memory, and history.
// PDF excerpts are not part of this allocation.
const BUDGET = {
  systemCore: 2000,
  characterDef: 3000,
  resonance: 800,
  selfState: 480,
  memories: 2400,
  voiceAnchors: 600,
  crossover: 800,
  history: 4000,
  userMessage: 600,
  operatorModel: 1200,
} as const;

/**
 * Existing history/context budget: the sum of the section caps above.
 * Persona, mood/resonance, and memory are built inside it first. PDF text
 * may use only the leftover characters, and is dropped before any of those
 * sections are shortened.
 */
export const PROMPT_CONTEXT_CHAR_BUDGET = Object.values(BUDGET).reduce(
  (sum, n) => sum + n,
  0,
);

function clientOwnsTranscript(systemPrompt?: string): boolean {
  if (!systemPrompt) return false;
  // Chat.jsx / buildGroupPrompt emit these as their own (possibly indented)
  // line. A mid-sentence mention in personality or scene text is not a
  // transcript and must not drop store history.
  return /(?:^|\n)\s*(?:Story so far:|CONVERSATION CONTEXT:)/i.test(systemPrompt);
}

/**
 * Chat.jsx already sends a full identity + transcript + guardrail prompt.
 * Wrapping up to 24k of that as CLIENT_SCENE_CONTEXT on top of CHARACTER /
 * CORE_BEHAVIOR doubles prefill and delays first token.
 */
export const CLIENT_SCENE_CONTEXT_MAX = 2_000;

/**
 * Assembled system prompt cap (~4 characters per token).
 * Persona, mood, and memory outrank the scene excerpt so CPU prefill on a
 * small droplet stays inside `LLM_LOCAL_FIRST_TOKEN_MS`.
 */
export const COMPANION_SYSTEM_PROMPT_MAX_CHARS = 6_400;

/** Rough token count for prefill estimates. Not a tokenizer. */
export function approxPromptTokens(text: string): number {
  const chars = String(text || "").length;
  return chars === 0 ? 0 : Math.ceil(chars / 4);
}

/**
 * Conservative token estimate for the local prompt cap.
 * A Natasha turn on qwen2.5:0.5b measured about 4.4 characters per token.
 * 4.0 over-counts slightly so a prompt that fits this budget stays inside
 * the real token count on a cache miss.
 */
export const LOCAL_PROMPT_CHARS_PER_TOKEN = 4;

/**
 * Droplet context window: n_ctx 8192 (Modelfile `num_ctx`, native `/api/chat`).
 * Overflow truncates from the front, which would drop the persona first, so
 * prompt tokens plus `num_predict` must stay under 8192 with this margin for
 * chat-template tokens the char estimate does not count. The trim loop still
 * targets `LOCAL_PROMPT_MAX_TOKENS` (1,240). Reading the prompt on the 1-vCPU
 * droplet is the limit (~50 tokens/s), not this window.
 */
export const OLLAMA_N_CTX = 8192;
export const OLLAMA_N_KEEP = 4;
export const LOCAL_PROMPT_SAFETY_MARGIN_TOKENS = 256;

/**
 * Target prompt size for the local Ollama path. Prefill on one vCPU is about
 * 50 tokens/s, so the working set stays near 1,240 tokens. The trim loop uses
 * the smaller of this target and the hard window below.
 */
export const LOCAL_PROMPT_MAX_TOKENS = 1_240;

/**
 * Header over the remembered facts. The old header told the model to show it
 * knew the person, and a small model did that every turn: it recited
 * memories instead of answering the message in front of it.
 */
export const MEMORY_BACKGROUND_LINE =
  "Background from past conversations, not a topic: use a detail only when it fits what they just said, and never list these back.";

/**
 * Replaces the background line when they ask what you remember. The strict
 * line would make a small model refuse that question.
 */
export const MEMORY_RECALL_LINE =
  "They asked what you remember. Answer from the background below, in your own voice, and do not invent memories that are not listed.";

function asksToHearRememberedFacts(userText: string | null | undefined): boolean {
  const q = String(userText || "")
    .toLowerCase()
    .replace(/[’‘ʼ]/g, "'");
  return (
    /\bwhat do you (?:remember|recall|know) about me\b/.test(q) ||
    /\bwhat (?:do you|can you) remember\b/.test(q) ||
    /\bwhat(?:'s| is) (?:something |anything )?(?:that )?you remember\b/.test(q) ||
    /\bdo you remember (?:anything|something|what|me|about)\b/.test(q) ||
    /\btell me (?:everything |what |all )?(?:that )?you remember\b/.test(q) ||
    /\bwhat have you (?:learned|remembered) about me\b/.test(q) ||
    /\bwhat memories do you have\b/.test(q)
  );
}

/** Background rule, or the recall rule when this message asks for memories. */
export function memoryBackgroundLine(userText: string | null | undefined): string {
  return asksToHearRememberedFacts(userText)
    ? MEMORY_RECALL_LINE
    : MEMORY_BACKGROUND_LINE;
}

/**
 * Most remembered facts one companion turn carries. Up to 12 facts drowned
 * the user's words on the 0.5B local model, so it answered the memories
 * instead. The best-scoring facts for this message still come first.
 * Solo, group, and proactive turns all use this ceiling.
 */
export const COMPANION_MEMORY_TOP_K = 4;

/** Prompt tokens that still leave room for a full local decode inside n_ctx. */
export function localPromptHardMaxTokens(
  numPredict = OLLAMA_NUM_PREDICT_CAP,
): number {
  const predict =
    Number.isFinite(numPredict) && numPredict > 0
      ? Math.floor(numPredict)
      : OLLAMA_NUM_PREDICT_CAP;
  return Math.max(0, OLLAMA_N_CTX - predict - LOCAL_PROMPT_SAFETY_MARGIN_TOKENS);
}

/** Working cap: about 1.5–2k tokens, and always inside the hard window. */
export function localPromptTokenBudget(
  numPredict = OLLAMA_NUM_PREDICT_CAP,
): number {
  return Math.min(LOCAL_PROMPT_MAX_TOKENS, localPromptHardMaxTokens(numPredict));
}

export function estimateLocalPromptTokens(text: string): number {
  const chars = String(text || "").length;
  return chars === 0 ? 0 : Math.ceil(chars / LOCAL_PROMPT_CHARS_PER_TOKEN);
}

/** Shorten a block so its estimate stays inside `maxTokens`. Wording is unchanged up to the cut. */
export function capBlockToLocalTokens(text: string, maxTokens: number): string {
  const value = String(text || "").trim();
  if (!value || !Number.isFinite(maxTokens) || maxTokens <= 0) return "";
  const maxChars = Math.floor(maxTokens * LOCAL_PROMPT_CHARS_PER_TOKEN);
  if (value.length <= maxChars) return value;
  if (maxChars <= 1) return "";
  return `${value.slice(0, maxChars - 1).trimEnd()}…`;
}

const CLIENT_REGION_BLOCK_RE =
  /(?:REAL-WORLD REGION KNOWLEDGE[^\n]*\n)?<<<USER_REGION>>>[\s\S]*?<<<END_USER_REGION>>>/g;

function stripClientRegionBlock(value: string): string {
  return String(value || "")
    .replace(CLIENT_REGION_BLOCK_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface PromptPiece {
  text: string;
  /** Lower ranks are dropped first. Rank >= 110 is reserved (safety / mode). */
  rank: number;
}

const PROMPT_PROTECT_RANK = 80;
const PROMPT_RESERVE_RANK = 110;

/**
 * Drop scene and other extras before persona, mood, and memory. Reserved
 * safety lines stay intact. Infinity skips the cap (measurement / tests).
 */
export function fitCompanionSystemPrompt(
  pieces: PromptPiece[],
  maxChars: number = COMPANION_SYSTEM_PROMPT_MAX_CHARS,
): string {
  const live = pieces
    .map((piece) => ({ ...piece, text: String(piece.text || "").trim() }))
    .filter((piece) => piece.text.length > 0);
  const full = () => live.filter((piece) => piece.text).map((piece) => piece.text).join("\n\n");
  if (!Number.isFinite(maxChars) || maxChars <= 0 || full().length <= maxChars) {
    return full();
  }

  const reserved = live.filter((piece) => piece.rank >= PROMPT_RESERVE_RANK);
  const reservedText = reserved.map((piece) => piece.text).join("\n\n");
  const bodyBudget = Math.max(
    0,
    maxChars - reservedText.length - (reservedText ? 2 : 0),
  );
  const body = live.filter((piece) => piece.rank < PROMPT_RESERVE_RANK);
  const renderBody = () =>
    body.filter((piece) => piece.text).map((piece) => piece.text).join("\n\n");

  const droppable = body
    .filter((piece) => piece.rank < PROMPT_PROTECT_RANK)
    .sort((a, b) => a.rank - b.rank);
  for (const piece of droppable) {
    if (renderBody().length <= bodyBudget) break;
    piece.text = "";
  }

  const trimmable = body
    .filter((piece) => piece.text && piece.rank < 100)
    .sort((a, b) => a.rank - b.rank);
  for (const piece of trimmable) {
    const current = renderBody();
    if (current.length <= bodyBudget) break;
    const over = current.length - bodyBudget;
    const floor = piece.rank >= 90 ? 400 : piece.rank >= 82 ? 240 : 0;
    const nextLen = Math.max(floor, piece.text.length - over - 1);
    if (nextLen >= piece.text.length) continue;
    piece.text = nextLen <= 1 ? "" : `${piece.text.slice(0, Math.max(0, nextLen - 1))}…`;
  }

  let bodyText = renderBody();
  if (bodyText.length > bodyBudget) {
    bodyText = bodyBudget <= 1 ? "" : `${bodyText.slice(0, bodyBudget - 1)}…`;
  }
  return [bodyText, ...reserved.map((piece) => piece.text)].filter(Boolean).join("\n\n");
}