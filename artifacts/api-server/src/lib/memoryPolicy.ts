/**
 * Phase 1 memory policy for the live companion_memories pipeline.
 *
 * After a meaningful exchange, a deferred job extracts candidates, scores
 * them, drops duplicates, classifies them, and writes them onto the existing
 * facts array. There is no second memory table and no model call.
 *
 * User facts stay about the human. The companion's identity lock is never
 * rewritten: a core memory is a protected proposal, and an existing protected
 * core fact is left as it was.
 */

import { createHash } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  companionMemories,
  db,
  ensureSchemaOnce,
  memoryEmbeddings,
  withTransientDbRetry,
} from "@workspace/db";
import { synchroStrengthFromEmotionalState } from "./companionAffect";
import { readChatTurn } from "./chatTurnLedger";
import { DeferredLlmRetryError } from "./deferredLocalLlm";
import { upsertMemoryEmbeddings } from "./memoryEmbeddings";
import { CONTINUE_USER_TURN } from "./promptBuilder";
import { loadRelationshipState } from "./relationshipEngine";
import { turnMetadataReplaced } from "./replyReplacement";
import { isRoleSwapReply } from "./roleSwapReply";

export const IMPORTANCE_DISCARD_BELOW = 0.3;
export const CORE_IMPORTANCE_ABOVE = 0.9;

/** semantic 0.40, emotion 0.25, relationship 0.20, novelty 0.15. */
export const IMPORTANCE_WEIGHTS = {
  semantic: 0.4,
  emotional: 0.25,
  relationship: 0.2,
  novelty: 0.15,
} as const;

const TURN_FACT_CAP = 24;
const POLICY_FACT_CAP = 40;
/** A repeat is less novel than a first sighting, and more novel than a copy. */
const REPEAT_NOVELTY = 0.35;

const GREETING =
  /^(?:hi|hey|hello|yo|sup|thanks|thank you|ok|okay|k|yes|no|yeah|yep|nah|lol|haha|cool|sure|good morning|good night)[.!?\s]*$/i;

const WEAK_OBJECTS = new Set([
  "it",
  "that",
  "this",
  "them",
  "something",
  "anything",
  "stuff",
]);

export type MemoryClass = "episodic" | "semantic" | "core";
export type MemoryAbout = "user" | "companion";

export type MemoryCandidate = {
  content: string;
  type: MemoryClass;
  importance: number;
  confidence: number;
  emotionalWeight: number;
  subject: string;
  predicate: string;
  object: string;
  about: MemoryAbout;
  identityRelevant: boolean;
};

export type PolicyFact = {
  type: "factual" | "emotional";
  memory_class: MemoryClass;
  text: string;
  subject: string;
  predicate: string;
  object: string;
  about: MemoryAbout;
  importance: number;
  confidence: number;
  emotional_weight: number;
  identity_relevant: boolean;
  protected?: boolean;
  proposal?: boolean;
  repeats?: number;
  session_id?: string;
  turn_id?: string;
  fact_id: string;
  created_at: string;
  /** Set when a person corrected this sentence. Consolidation must not rewrite it. */
  user_edited?: boolean;
  /** Mirrors `object` after a correction so the structured value matches the sentence. */
  value?: string;
  updated_at?: string;
};

/**
 * A forgotten fact stays in the same `facts` array. It has no memory class and
 * no sentence, so it is not a policy fact and it does not appear on the
 * review screen. Consolidation and extraction match it by the normalized
 * subject/predicate/object key and refuse to store that fact again.
 */
export type ForgottenFact = {
  forgotten: true;
  fact_id: string;
  about: MemoryAbout;
  subject: string;
  predicate: string;
  object: string;
  deleted_at: string;
  /** Chat turn this fact was taken from, when one was stored. */
  turn_id?: string;
  /** Sentence that was forgotten, so retrieval can keep it out of the prompt. */
  source_text?: string;
};

type RawHit = {
  start: number;
  end: number;
  about: MemoryAbout;
  subject: string;
  predicate: string;
  object: string;
  semantic: number;
  confidence: number;
  kind: "episodic" | "semantic";
  identityRelevant: boolean;
  retrieval: "factual" | "emotional";
};

export type PolicyDecision = {
  action: "discard" | "save";
  candidate: MemoryCandidate;
};

export type ConsolidationResult = {
  facts: unknown[];
  candidates: MemoryCandidate[];
  saved: PolicyFact[];
  discarded: number;
  promoted: number;
  coreProposed: number;
};

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scoreImportance(input: {
  semantic: number;
  emotional: number;
  relationship: number;
  novelty: number;
}): number {
  const raw =
    IMPORTANCE_WEIGHTS.semantic * clamp01(input.semantic) +
    IMPORTANCE_WEIGHTS.emotional * clamp01(input.emotional) +
    IMPORTANCE_WEIGHTS.relationship * clamp01(input.relationship) +
    IMPORTANCE_WEIGHTS.novelty * clamp01(input.novelty);
  return Math.round(raw * 1000) / 1000;
}

export function policyDedupeKey(parts: {
  about?: string;
  subject?: string;
  predicate?: string;
  object?: string;
}): string {
  const norm = (value: string | undefined) =>
    String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  return [norm(parts.about), norm(parts.subject), norm(parts.predicate), norm(parts.object)].join(
    "|",
  );
}

export function policyFactId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 24);
}

export function isForgottenFact(item: unknown): item is ForgottenFact {
  if (!item || typeof item !== "object") return false;
  const rec = item as Record<string, unknown>;
  return (
    rec.forgotten === true &&
    typeof rec.fact_id === "string" &&
    (rec.about === "user" || rec.about === "companion") &&
    typeof rec.subject === "string" &&
    typeof rec.predicate === "string" &&
    typeof rec.object === "string"
  );
}

export function isPolicyFact(item: unknown): item is PolicyFact {
  if (!item || typeof item !== "object") return false;
  const rec = item as Record<string, unknown>;
  if (rec.forgotten === true) return false;
  const memoryClass = rec.memory_class;
  const about = rec.about;
  return (
    (memoryClass === "episodic" || memoryClass === "semantic" || memoryClass === "core") &&
    (about === "user" || about === "companion") &&
    typeof rec.text === "string" &&
    typeof rec.fact_id === "string"
  );
}

/**
 * Emotion comes from the stored self-state. A missing self-state is 0, not
 * the resting affect floor, so a quiet row does not inflate every memory.
 * Synchro is the bond signal already on this row. Relationship level, when
 * a row exists, is applied by the deferred job.
 */
export function memoryPolicySignals(emotionalState: unknown): {
  emotionalIntensity: number;
  synchroImportance: number | null;
} {
  if (!emotionalState || typeof emotionalState !== "object") {
    return { emotionalIntensity: 0, synchroImportance: null };
  }
  const state = emotionalState as Record<string, unknown>;
  const self = state.selfState;
  let emotionalIntensity = 0;
  if (self && typeof self === "object") {
    const intensity = (self as Record<string, unknown>).intensity;
    if (typeof intensity === "number" && Number.isFinite(intensity)) {
      emotionalIntensity = clamp01(intensity / 100);
    }
  }
  const synchro = synchroStrengthFromEmotionalState(state);
  return {
    emotionalIntensity,
    synchroImportance: synchro == null ? null : clamp01(synchro / 100),
  };
}

export function isMeaningfulExchange(userContent: string, assistantContent: string): boolean {
  const user = userContent.trim();
  const assistant = assistantContent.trim();
  if (!user || !assistant) return false;
  if (user === CONTINUE_USER_TURN) return false;
  if (GREETING.test(user)) return false;
  return true;
}

export function decideMemoryCandidate(input: {
  content: string;
  semantic: number;
  confidence: number;
  emotionalIntensity: number;
  relationshipImportance: number;
  novelty: number;
  about: MemoryAbout;
  kind: "episodic" | "semantic";
  identityRelevant: boolean;
  subject: string;
  predicate: string;
  object: string;
}): PolicyDecision {
  const emotionalWeight = clamp01(input.emotionalIntensity);
  const importance = scoreImportance({
    semantic: input.semantic,
    emotional: emotionalWeight,
    relationship: input.relationshipImportance,
    novelty: input.novelty,
  });
  const identityRelevant = input.about === "companion" && input.identityRelevant;
  let type: MemoryClass = input.kind === "episodic" ? "episodic" : "semantic";
  let action: PolicyDecision["action"] = "save";
  if (input.about === "user") {
    type = input.kind === "episodic" ? "episodic" : "semantic";
  } else if (identityRelevant && importance > CORE_IMPORTANCE_ABOVE) {
    type = "core";
  } else {
    action = "discard";
  }
  if (importance < IMPORTANCE_DISCARD_BELOW) action = "discard";
  return {
    action,
    candidate: {
      content: input.content,
      type,
      importance,
      confidence: clamp01(input.confidence),
      emotionalWeight,
      subject: input.subject,
      predicate: input.predicate,
      object: input.object,
      about: input.about,
      identityRelevant,
    },
  };
}

/** Extraction objects stay short. A person's correction may use the full edit. */
export const CORRECTED_VALUE_MAX = 500;

function cleanObject(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.!?,;:]+$/g, "").trim().slice(0, 80);
}

function correctedValue(value: string): string {
  return value.replace(/\s+/g, " ").replace(/[.!?,;:]+$/g, "").trim().slice(0, CORRECTED_VALUE_MAX);
}

function namesMatch(object: string, companionName: string): boolean {
  const left = object.toLowerCase().replace(/\s+/g, " ").trim();
  const right = companionName.toLowerCase().replace(/\s+/g, " ").trim();
  if (!left || !right || left.length < 3) return false;
  if (left === right) return true;
  return right.split(" ").some((part) => part.length >= 3 && part === left);
}

const USER_SENTENCE_PREFIX: Record<string, string> = {
  name: "The human's name is ",
  called: "The human prefers to be called ",
  lives_in: "The human lives in ",
  from: "The human is from ",
  works: "The human works ",
  prefers: "The human prefers ",
  enjoys: "The human enjoys ",
  dislikes: "The human dislikes ",
  felt: "The human felt this: ",
  did: "The human did this: ",
};

const REPEATED_FACT_PREFIX = "The human has done this more than once: ";

function userFactText(predicate: string, object: string, repeated = false): string {
  if (repeated) return `${REPEATED_FACT_PREFIX}${object}.`;
  const prefix = USER_SENTENCE_PREFIX[predicate];
  if (prefix) return `${prefix}${object}.`;
  return `The human ${predicate}: ${object}.`;
}

export type CorrectedFactShape = {
  predicate: string;
  object: string;
  /** True when the sentence used a known prefix, so the predicate was re-read. */
  matched: boolean;
};

/**
 * Read the predicate from the corrected sentence, then the object that follows
 * that prefix. "The human enjoys chess" is enjoys/chess, even when the stored
 * fact used to be a name. A sentence with no known prefix keeps the old predicate.
 * The value is not cut at the extraction cap; it follows the edit limit.
 */
export function shapeFromCorrectedText(fallbackPredicate: string, text: string): CorrectedFactShape {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const prefixes = Object.entries(USER_SENTENCE_PREFIX).sort((a, b) => b[1].length - a[1].length);
  for (const [predicate, prefix] of prefixes) {
    if (cleaned.toLowerCase().startsWith(prefix.toLowerCase())) {
      return { predicate, object: correctedValue(cleaned.slice(prefix.length)), matched: true };
    }
  }
  if (cleaned.toLowerCase().startsWith(REPEATED_FACT_PREFIX.toLowerCase())) {
    return {
      predicate: fallbackPredicate,
      object: correctedValue(cleaned.slice(REPEATED_FACT_PREFIX.length)),
      matched: true,
    };
  }
  const generic = new RegExp(`^the human ${fallbackPredicate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:\\s+`, "i");
  if (generic.test(cleaned)) {
    return {
      predicate: fallbackPredicate,
      object: correctedValue(cleaned.replace(generic, "")),
      matched: true,
    };
  }
  // The same phrases a chat turn would extract, so "My name is Samuel."
  // lands on the name key instead of a second fact with the whole sentence.
  const spoken = extractRaw(cleaned, "", "").filter((hit) => hit.about === "user");
  if (spoken.length === 1) {
    const hit = spoken[0]!;
    return { predicate: hit.predicate, object: correctedValue(hit.object), matched: true };
  }
  return { predicate: fallbackPredicate, object: correctedValue(cleaned), matched: false };
}

function coreProposalText(name: string, predicate: string, object: string): string {
  const who = name.trim() || "the companion";
  return `Protected identity proposal (not applied): ${who} — ${predicate} ${object}.`;
}

function assistantHandsIdentityToHuman(text: string, companionName: string): boolean {
  if (isRoleSwapReply(text, companionName)) return true;
  const name = companionName.trim();
  if (!name) return false;
  const first = name.split(/\s+/)[0] || "";
  const names = [name];
  if (first.length >= 3 && first.toLowerCase() !== name.toLowerCase()) names.push(first);
  const escaped = names.map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(
    `\\byou(?:\\s+are(?!n['’]t)|'re|’re)\\s+(?:${escaped.join("|")})\\b`,
    "i",
  ).test(text);
}

function consider(
  hits: RawHit[],
  start: number,
  end: number,
  hit: Omit<RawHit, "start" | "end" | "object"> & { object: string },
): void {
  if (hits.some((other) => start < other.end && other.start < end)) return;
  const object = cleanObject(hit.object);
  if (object.length < 2) return;
  if (hit.kind === "semantic" && hit.predicate !== "name" && hit.predicate !== "called") {
    if (WEAK_OBJECTS.has(object.toLowerCase())) return;
  }
  hits.push({ ...hit, start, end, object });
}

function matchAll(
  text: string,
  pattern: RegExp,
  build: (match: RegExpExecArray) => Omit<RawHit, "start" | "end"> | null,
  hits: RawHit[],
): void {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const re = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const built = build(match);
    if (!built) continue;
    consider(hits, match.index, match.index + match[0].length, built);
  }
}

function extractRaw(
  userContent: string,
  assistantContent: string,
  companionName: string,
): RawHit[] {
  const hits: RawHit[] = [];
  const user = userContent.trim();

  matchAll(
    user,
    /\b(?:please\s+)?(?:call me|i prefer to be called|i'm called|i am called)\s+([A-Za-z][\p{L}'’-]{1,40}(?:\s+[A-Za-z][\p{L}'’-]{1,40})?)/iu,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "called",
      object: match[1] || "",
      semantic: 0.9,
      confidence: 0.88,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bmy name is\s+([A-Za-z][\p{L}'’-]{1,40}(?:\s+[A-Za-z][\p{L}'’-]{1,40})?)/iu,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "name",
      object: match[1] || "",
      semantic: 0.95,
      confidence: 0.9,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi live in\s+([^.,!?\n]{2,60})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "lives_in",
      object: match[1] || "",
      semantic: 0.75,
      confidence: 0.8,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\b(?:i am from|i'm from)\s+([^.,!?\n]{2,60})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "from",
      object: match[1] || "",
      semantic: 0.7,
      confidence: 0.75,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi work (?:as|at|for)\s+([^.,!?\n]{2,60})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "works",
      object: match[1] || "",
      semantic: 0.7,
      confidence: 0.75,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi enjoy\s+([^.,!?\n]{2,80})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "enjoys",
      object: match[1] || "",
      semantic: 0.55,
      confidence: 0.7,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi (?:prefer|like)\s+([^.,!?\n]{2,80})/i,
    (match) => {
      const object = match[1] || "";
      if (/^to be called\b/i.test(object)) return null;
      return {
        about: "user",
        subject: "user",
        predicate: "prefers",
        object,
        semantic: 0.55,
        confidence: 0.7,
        kind: "semantic",
        identityRelevant: false,
        retrieval: "factual",
      };
    },
    hits,
  );
  matchAll(
    user,
    /\bi (?:hate|dislike)\s+([^.,!?\n]{2,80})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "dislikes",
      object: match[1] || "",
      semantic: 0.55,
      confidence: 0.65,
      kind: "semantic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi (?:love|miss)\s+([^.,!?\n]{2,80})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "felt",
      object: match[1] || "",
      semantic: 0.6,
      confidence: 0.6,
      kind: "episodic",
      identityRelevant: false,
      retrieval: "emotional",
    }),
    hits,
  );
  matchAll(
    user,
    /\b(?:yesterday|today|last night|this morning)\s+i\s+([^.,!?\n]{4,100})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "did",
      object: match[1] || "",
      semantic: 0.55,
      confidence: 0.65,
      kind: "episodic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi just\s+(?!wanted\b|want\b|need\b|think\b|feel\b|mean\b)([^.,!?\n]{4,100})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "did",
      object: match[1] || "",
      semantic: 0.55,
      confidence: 0.6,
      kind: "episodic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );
  matchAll(
    user,
    /\bi started\s+([^.,!?\n]{4,100})/i,
    (match) => ({
      about: "user",
      subject: "user",
      predicate: "did",
      object: match[1] || "",
      semantic: 0.55,
      confidence: 0.65,
      kind: "episodic",
      identityRelevant: false,
      retrieval: "factual",
    }),
    hits,
  );

  const assistant = assistantContent.trim();
  if (assistant && companionName.trim() && !assistantHandsIdentityToHuman(assistant, companionName)) {
    const name = companionName.trim();
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const first = name.split(/\s+/)[0] || "";
    const firstOk = first.length >= 3 && first.toLowerCase() !== name.toLowerCase();
    const namePattern = firstOk
      ? `(?:${escaped}|${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`
      : escaped;
    matchAll(
      assistant,
      new RegExp(`\\b(?:my name is|i am|i'm)\\s+${namePattern}\\b`, "i"),
      () => ({
        about: "companion",
        subject: "companion",
        predicate: "name",
        object: name,
        semantic: 1,
        confidence: 0.8,
        kind: "semantic",
        identityRelevant: true,
        retrieval: "factual",
      }),
      hits,
    );
    matchAll(
      assistant,
      /\b(?:i was born(?: in)?|i come from|i grew up in)\s+([^.,!?\n]{2,60})/i,
      (match) => ({
        about: "companion",
        subject: "companion",
        predicate: "origin",
        object: match[1] || "",
        semantic: 0.85,
        confidence: 0.62,
        kind: "semantic",
        identityRelevant: true,
        retrieval: "factual",
      }),
      hits,
    );
    matchAll(
      assistant,
      /\bi will never\s+([^.,!?\n]{3,80})/i,
      (match) => ({
        about: "companion",
        subject: "companion",
        predicate: "will_never",
        object: match[1] || "",
        semantic: 0.82,
        confidence: 0.6,
        kind: "semantic",
        identityRelevant: true,
        retrieval: "factual",
      }),
      hits,
    );
  }

  return hits.filter((hit) => {
    if (hit.about !== "user") return true;
    if (hit.predicate !== "name" && hit.predicate !== "called") return true;
    return !namesMatch(hit.object, companionName);
  });
}

function findPolicy(facts: unknown[], key: string): PolicyFact | undefined {
  return facts.find(
    (item): item is PolicyFact => isPolicyFact(item) && policyDedupeKey(item) === key,
  );
}

function findForgotten(facts: unknown[], key: string): ForgottenFact | undefined {
  return facts.find(
    (item): item is ForgottenFact => isForgottenFact(item) && policyDedupeKey(item) === key,
  );
}

function capPolicyFacts(facts: unknown[]): unknown[] {
  const policy = facts.filter(isPolicyFact);
  if (policy.length <= POLICY_FACT_CAP) return facts;
  const droppable = policy
    .filter((fact) => fact.user_edited !== true && !(fact.protected && fact.memory_class === "core"))
    .sort((a, b) => a.importance - b.importance);
  const overflow = policy.length - POLICY_FACT_CAP;
  const dropIds = new Set(droppable.slice(0, overflow).map((fact) => fact.fact_id));
  return facts.filter((item) => !isPolicyFact(item) || !dropIds.has(item.fact_id));
}

/**
 * Older rows stored a sentence with no memory class. Those are not chat
 * crumbs, so the turn window must not drop them.
 */
export function isLegacyTextFact(item: unknown): boolean {
  if (!item || typeof item !== "object") return false;
  if (isPolicyFact(item) || isForgottenFact(item)) return false;
  const rec = item as Record<string, unknown>;
  if (rec.type === "turn" || typeof rec.turn_id === "string") return false;
  return typeof rec.text === "string" && rec.text.trim().length > 0;
}

function isTurnCrumb(item: unknown): boolean {
  return Boolean(
    item &&
      typeof item === "object" &&
      !isPolicyFact(item) &&
      !isForgottenFact(item) &&
      !isLegacyTextFact(item),
  );
}

/**
 * Keep classified facts and forgotten markers when the turn crumb window
 * slides. Turn rows stay capped. Policy rows and tombstones are not evicted
 * by that window. Returns null when this turn was already stored.
 */
/**
 * Drop turn crumbs and policy facts that were extracted from a reply the
 * user replaced. Facts with no turn id stay; they are not that reply.
 */
export function factsWithoutTurn(facts: unknown[], turnId: string): unknown[] {
  const id = turnId.trim();
  if (!id) return Array.isArray(facts) ? facts.slice() : [];
  return (Array.isArray(facts) ? facts : []).filter((item) => {
    if (!item || typeof item !== "object") return true;
    return String((item as { turn_id?: unknown }).turn_id || "") !== id;
  });
}

export function appendTurnMemoryFact(
  existing: unknown[],
  turnFact: Record<string, unknown>,
): Record<string, unknown>[] | null {
  const turnId = turnFact.turn_id;
  if (
    turnId &&
    existing.some(
      (item) => isTurnCrumb(item) && (item as Record<string, unknown>).turn_id === turnId,
    )
  ) {
    return null;
  }
  const kept = existing.filter(
    (item) => isPolicyFact(item) || isForgottenFact(item) || isLegacyTextFact(item),
  );
  const turns = existing.filter(isTurnCrumb);
  const nextTurns = turns.slice(-(TURN_FACT_CAP - 1));
  nextTurns.push(turnFact);
  return [...kept, ...nextTurns.slice(-TURN_FACT_CAP)] as Record<string, unknown>[];
}

export function consolidateExchange(input: {
  userContent: string;
  assistantContent: string;
  companionName: string;
  existingFacts?: unknown[] | null;
  emotionalIntensity?: number;
  relationshipImportance?: number;
  sessionId?: string;
  turnId?: string;
  now?: string;
}): ConsolidationResult {
  const existing = Array.isArray(input.existingFacts) ? input.existingFacts.slice() : [];
  const empty: ConsolidationResult = {
    facts: existing,
    candidates: [],
    saved: [],
    discarded: 0,
    promoted: 0,
    coreProposed: 0,
  };
  if (!isMeaningfulExchange(input.userContent, input.assistantContent)) return empty;

  const emotionalIntensity = clamp01(input.emotionalIntensity ?? 0);
  const relationshipImportance = clamp01(input.relationshipImportance ?? 0);
  const now = input.now ?? new Date().toISOString();
  let facts = existing.slice();
  const candidates: MemoryCandidate[] = [];
  const saved: PolicyFact[] = [];
  let discarded = 0;
  let promoted = 0;
  let coreProposed = 0;

  for (const hit of extractRaw(input.userContent, input.assistantContent, input.companionName)) {
    const key = policyDedupeKey(hit);
    const prior = findPolicy(facts, key);
    const novelty = !prior ? 1 : prior.memory_class === "episodic" ? REPEAT_NOVELTY : 0;
    const content =
      hit.about === "companion"
        ? coreProposalText(input.companionName, hit.predicate, hit.object)
        : userFactText(hit.predicate, hit.object);
    const decision = decideMemoryCandidate({
      content,
      semantic: hit.semantic,
      confidence: hit.confidence,
      emotionalIntensity,
      relationshipImportance,
      novelty,
      about: hit.about,
      kind: hit.kind,
      identityRelevant: hit.identityRelevant,
      subject: hit.subject,
      predicate: hit.predicate,
      object: hit.object,
    });
    candidates.push(decision.candidate);

    // A forgotten key must not be saved or promoted back into a live fact.
    // A sentence the person corrected keeps its wording, including an
    // episodic fact that would otherwise be rewritten on the next repeat.
    if (findForgotten(facts, key) || prior?.user_edited === true) {
      discarded += 1;
      continue;
    }

    if (prior?.memory_class === "episodic") {
      const repeats = (prior.repeats ?? 1) + 1;
      const next: PolicyFact = {
        ...prior,
        memory_class: "semantic",
        type: prior.type === "emotional" ? "emotional" : "factual",
        text: userFactText(prior.predicate, prior.object, true),
        importance: Math.max(prior.importance, decision.candidate.importance),
        confidence: Math.min(0.99, Math.max(prior.confidence, decision.candidate.confidence)),
        emotional_weight: decision.candidate.emotionalWeight,
        repeats,
      };
      facts = facts.map((item) => (isPolicyFact(item) && item.fact_id === prior.fact_id ? next : item));
      promoted += 1;
      continue;
    }

    if (decision.action === "discard") {
      discarded += 1;
      continue;
    }

    if (prior && (prior.memory_class === "semantic" || prior.memory_class === "core")) {
      discarded += 1;
      continue;
    }

    const fact: PolicyFact = {
      type: hit.retrieval,
      memory_class: decision.candidate.type,
      text: decision.candidate.content,
      subject: hit.subject,
      predicate: hit.predicate,
      object: hit.object,
      about: hit.about,
      importance: decision.candidate.importance,
      confidence: decision.candidate.confidence,
      emotional_weight: decision.candidate.emotionalWeight,
      identity_relevant: decision.candidate.identityRelevant,
      session_id: input.sessionId,
      turn_id: input.turnId,
      fact_id: policyFactId(key),
      created_at: now,
      repeats: 1,
    };
    if (fact.memory_class === "core") {
      fact.protected = true;
      fact.proposal = true;
      coreProposed += 1;
    }
    facts = capPolicyFacts([...facts, fact]);
    saved.push(fact);
  }

  return { facts, candidates, saved, discarded, promoted, coreProposed };
}

/** Re-index the corrected sentence on the existing deferred memory-policy path. */
export function buildMemoryReembedJob(input: {
  userId: string;
  characterId: string;
  factId?: string;
}): {
  id: string;
  userId: string;
  kind: "memory-policy";
  payload: Record<string, unknown>;
} | null {
  const userId = input.userId.trim();
  const characterId = input.characterId.trim();
  const factId = input.factId?.trim() || "";
  if (!userId || !characterId) return null;
  return {
    id: `memory-policy:reembed:${userId}:${characterId}:${factId || "all"}`,
    userId,
    kind: "memory-policy",
    payload: {
      userId,
      characterId,
      reembedOnly: true,
      factId,
    },
  };
}

export function buildMemoryPolicyJob(input: {
  userId: string;
  characterId: string;
  sessionId: string;
  turnId: string;
  companionName: string;
  userContent: string;
  assistantContent: string;
}): {
  id: string;
  userId: string;
  kind: "memory-policy";
  payload: Record<string, unknown>;
} | null {
  const userId = input.userId.trim();
  const characterId = input.characterId.trim();
  const turnId = input.turnId.trim();
  if (!userId || !characterId || !turnId) return null;
  if (!isMeaningfulExchange(input.userContent, input.assistantContent)) return null;
  return {
    id: `memory-policy:${userId}:${characterId}:${turnId}`,
    userId,
    kind: "memory-policy",
    payload: {
      userId,
      characterId,
      sessionId: input.sessionId,
      turnId,
      companionName: input.companionName.trim(),
      userContent: input.userContent.slice(0, 1000),
      assistantContent: input.assistantContent.slice(0, 1000),
    },
  };
}

type CompanionMemoryTx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Same companion-row lock the review route uses, held for one transaction. */
export async function withCompanionMemoryLock<T>(
  userId: string,
  characterId: string,
  run: (tx: CompanionMemoryTx) => Promise<T>,
): Promise<T> {
  return withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${characterId}`}))`);
      return run(tx);
    }),
  );
}

async function readCompanionFactRows(
  tx: CompanionMemoryTx,
  userId: string,
  characterId: string,
): Promise<unknown[]> {
  const [existing] = await tx
    .select({ facts: companionMemories.facts })
    .from(companionMemories)
    .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
    .limit(1);
  return Array.isArray(existing?.facts) ? existing.facts : [];
}

function embeddablePolicyFacts(facts: unknown[]): PolicyFact[] {
  return facts.filter(isPolicyFact).filter((fact) => fact.proposal !== true);
}

/** Index the sentences that are stored now. Does not call a chat model. */
async function reembedCurrentFacts(userId: string, characterId: string, factId: string): Promise<void> {
  const embeddable = await withCompanionMemoryLock(userId, characterId, async (tx) => {
    const facts = embeddablePolicyFacts(await readCompanionFactRows(tx, userId, characterId));
    return factId ? facts.filter((fact) => fact.fact_id === factId) : facts;
  });
  if (embeddable.length === 0) return;
  try {
    await upsertMemoryEmbeddings({
      userId,
      characterId,
      facts: embeddable.map((fact) => ({
        type: fact.type,
        text: fact.text,
        session_id: fact.session_id,
        created_at: fact.created_at,
        fact_id: fact.fact_id,
      })),
    });
  } catch {
    // Keyword retrieval still sees the corrected sentence.
  }
}

/**
 * Read and append a turn crumb inside the companion lock, so a review edit
 * or delete that commits first cannot be overwritten by a stale snapshot.
 * Returns false when this turn was already stored.
 */
export async function persistCompanionTurnFact(input: {
  userId: string;
  characterId: string;
  turnFact: Record<string, unknown>;
  now?: Date;
}): Promise<boolean> {
  const userId = input.userId.trim();
  const characterId = input.characterId.trim();
  if (!userId || !characterId) return false;
  const now = input.now ?? new Date();
  return withCompanionMemoryLock(userId, characterId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const facts = appendTurnMemoryFact(
      Array.isArray(existing?.facts) ? existing.facts : [],
      input.turnFact,
    );
    if (!facts) return false;
    await tx
      .insert(companionMemories)
      .values({
        userId,
        characterId,
        summary: existing?.summary ?? "",
        facts,
        emotionalState: existing?.emotionalState ?? {},
        resonanceNotes: existing?.resonanceNotes ?? "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [companionMemories.userId, companionMemories.characterId],
        set: {
          facts,
          updatedAt: now,
        },
      });
    return true;
  });
}

/**
 * Background consolidation. Reads the companion row (emotion + synchro) and
 * the existing relationship level, then writes facts only. Does not call a
 * model and does not touch operator_model or the character record.
 */
export async function runDeferredMemoryPolicy(
  payload: Record<string, unknown>,
  ctx: { signal: AbortSignal },
): Promise<void> {
  if (ctx.signal.aborted) {
    throw new DeferredLlmRetryError("memory policy waited for chat");
  }
  const userId = String(payload.userId || "").trim();
  const characterId = String(payload.characterId || "").trim();
  const userContent = String(payload.userContent || "");
  const assistantContent = String(payload.assistantContent || "");
  const companionName = String(payload.companionName || "");
  const sessionId = payload.sessionId ? String(payload.sessionId) : undefined;
  const turnId = payload.turnId ? String(payload.turnId) : undefined;
  if (!userId || !characterId) return;
  if (payload.reembedOnly === true) {
    await reembedCurrentFacts(userId, characterId, String(payload.factId || ""));
    return;
  }
  if (!isMeaningfulExchange(userContent, assistantContent)) return;
  if (turnId) {
    const turn = await readChatTurn(turnId, userId).catch(() => null);
    // A missing ledger row is a normal client turn. Only a turn the user
    // already replaced must not become a memory.
    if (turn && turnMetadataReplaced(turn.metadata)) return;
  }

  await ensureSchemaOnce();
  if (ctx.signal.aborted) {
    throw new DeferredLlmRetryError("memory policy waited for chat");
  }

  const relationship = await loadRelationshipState(characterId, userId);
  const now = new Date();
  const result = await withCompanionMemoryLock(userId, characterId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const signals = memoryPolicySignals(existing?.emotionalState);
    let relationshipImportance = signals.synchroImportance ?? 0;
    if (relationship && typeof relationship.relationship_level === "number") {
      relationshipImportance = clamp01(relationship.relationship_level / 100);
    }
    const consolidated = consolidateExchange({
      userContent,
      assistantContent,
      companionName,
      existingFacts: Array.isArray(existing?.facts) ? existing.facts : [],
      emotionalIntensity: signals.emotionalIntensity,
      relationshipImportance,
      sessionId,
      turnId,
    });
    if (consolidated.saved.length === 0 && consolidated.promoted === 0) return consolidated;
    const facts = consolidated.facts as Record<string, unknown>[];
    await tx
      .insert(companionMemories)
      .values({
        userId,
        characterId,
        summary: existing?.summary ?? "",
        facts,
        emotionalState: existing?.emotionalState ?? {},
        resonanceNotes: existing?.resonanceNotes ?? "",
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [companionMemories.userId, companionMemories.characterId],
        set: {
          facts,
          updatedAt: now,
        },
      });
    return consolidated;
  });

  if (result.saved.length === 0 && result.promoted === 0) return;

  // Re-read under the lock. A review delete or correction that landed after
  // consolidation must not be embedded from this job's earlier snapshot.
  const embeddable = await withCompanionMemoryLock(userId, characterId, async (tx) =>
    embeddablePolicyFacts(await readCompanionFactRows(tx, userId, characterId)),
  );
  if (embeddable.length > 0) {
    try {
      await upsertMemoryEmbeddings({
        userId,
        characterId,
        facts: embeddable.map((fact) => ({
          type: fact.type,
          text: fact.text,
          session_id: fact.session_id,
          created_at: fact.created_at,
          fact_id: fact.fact_id,
        })),
      });
    } catch {
      // Facts are already stored. Keyword retrieval still works.
    }
  }

  const embeddedIds = embeddable.map((fact) => fact.fact_id);
  if (embeddedIds.length === 0) return;
  await withCompanionMemoryLock(userId, characterId, async (tx) => {
    const liveText = new Map(
      embeddablePolicyFacts(await readCompanionFactRows(tx, userId, characterId)).map((fact) => [
        fact.fact_id,
        fact.text.trim(),
      ]),
    );
    const rows = await tx
      .select({ factId: memoryEmbeddings.factId, text: memoryEmbeddings.text })
      .from(memoryEmbeddings)
      .where(and(eq(memoryEmbeddings.userId, userId), eq(memoryEmbeddings.characterId, characterId)));
    const stale = embeddedIds.filter((id) => {
      const live = liveText.get(id);
      if (!live) return true;
      const row = rows.find((item) => item.factId === id);
      return Boolean(row && row.text.trim() !== live);
    });
    if (stale.length === 0) return;
    await tx
      .delete(memoryEmbeddings)
      .where(
        and(
          eq(memoryEmbeddings.userId, userId),
          eq(memoryEmbeddings.characterId, characterId),
          inArray(memoryEmbeddings.factId, stale),
        ),
      );
  });
}
