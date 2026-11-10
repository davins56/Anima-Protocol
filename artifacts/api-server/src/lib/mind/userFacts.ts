/**
 * Durable user facts, extracted after a turn and stored in the existing
 * append-only memory_events stream (event_type `note`, payload.kind
 * `user_fact`). No new table or event type: forgetting / superseding is a
 * `retraction` event, exactly like every other memory.
 */
import { getPool } from "@workspace/db";
import { appendMemoryEvent } from "../memoryCore/memoryCore";
import { jaccard, normalizeText, shortHash, tokenSet } from "./textSim";

export const USER_FACT_KIND = "user_fact";

export type UserFact = {
  id?: string;
  fact: string;
  category: FactCategory;
  importance: number;
  occurredAt?: string;
  /** Existing fact this one replaces (e.g. a move to a new city). */
  replaces?: string | null;
};

export const FACT_CATEGORIES = [
  "identity",
  "preference",
  "relationship",
  "work",
  "health",
  "goal",
  "event",
  "boundary",
  "other",
] as const;
export type FactCategory = (typeof FACT_CATEGORIES)[number];

const MAX_FACT_CHARS = 200;
/** Facts this similar to a stored one are the same fact. */
export const SAME_FACT_JACCARD = 0.7;

export function buildFactExtractionMessages(args: {
  userName?: string;
  companionName?: string;
  userMessage: string;
  companionReply: string;
  knownFacts: string[];
}): Array<{ role: "system" | "user"; content: string }> {
  const who = String(args.userName || "").trim() || "the user";
  const known = args.knownFacts.length
    ? args.knownFacts.map((f) => `- ${f}`).join("\n")
    : "(none yet)";
  return [
    {
      role: "system",
      content:
        "You extract durable facts about a person from one chat exchange with their companion. " +
        "Only facts the PERSON stated or clearly implied about themselves, their life, people, pets, preferences, plans, boundaries or important events. " +
        "Never facts about the companion, never roleplay fiction, never guesses, never one-off small talk (\"is tired today\"). " +
        "Write each fact as one short third-person sentence using their name. " +
        "If a fact updates a known fact, set \"replaces\" to the exact known fact text. " +
        'Reply with JSON only: {"facts":[{"fact":"...","category":"identity|preference|relationship|work|health|goal|event|boundary|other","importance":0.0-1.0,"replaces":null}]}. ' +
        'Reply {"facts":[]} when there is nothing durable.',
    },
    {
      role: "user",
      content:
        `Person's name: ${who}\nCompanion: ${args.companionName || "the companion"}\n\n` +
        `Known facts:\n${known}\n\n` +
        `Exchange:\n${who}: ${args.userMessage.slice(0, 1500)}\n${args.companionName || "Companion"}: ${args.companionReply.slice(0, 1200)}`,
    },
  ];
}

/** Pull the first JSON object/array out of a model reply (fences, prose, <think>). */
export function extractJsonPayload(raw: string): unknown {
  const text = String(raw || "")
    .replace(/<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi, "")
    .replace(/```(?:json)?/gi, "")
    .trim();
  const start = text.search(/[[{]/);
  if (start < 0) return null;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === open) depth += 1;
    else if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

const COMPANION_SUBJECT_RE = /^(?:i|i'm|i am|my|me|we|the companion|as an ai)\b/i;
const EPHEMERAL_RE = /\b(?:right now|at the moment|currently feeling|is tired|is bored|is hungry|said hi|said hello|greeted)\b/i;

/** Validate + normalise the extractor output. Unknown shapes yield []. */
export function parseExtractedFacts(raw: string): UserFact[] {
  const payload = extractJsonPayload(raw);
  const list = Array.isArray(payload)
    ? payload
    : payload && typeof payload === "object" && Array.isArray((payload as { facts?: unknown }).facts)
      ? ((payload as { facts: unknown[] }).facts)
      : [];
  const out: UserFact[] = [];
  for (const item of list) {
    const rec = (typeof item === "string" ? { fact: item } : item) as Record<string, unknown> | null;
    if (!rec || typeof rec !== "object") continue;
    let fact = String(rec.fact ?? rec.text ?? "").replace(/\s+/g, " ").trim();
    if (fact.length < 6) continue;
    if (fact.length > MAX_FACT_CHARS) fact = `${fact.slice(0, MAX_FACT_CHARS - 1).trimEnd()}…`;
    if (COMPANION_SUBJECT_RE.test(fact)) continue;
    if (EPHEMERAL_RE.test(fact)) continue;
    const cat = String(rec.category || "other").toLowerCase() as FactCategory;
    const importance = Number(rec.importance);
    const replaces = typeof rec.replaces === "string" && rec.replaces.trim() ? rec.replaces.trim() : null;
    if (out.some((f) => jaccard(tokenSet(f.fact), tokenSet(fact)) >= SAME_FACT_JACCARD)) continue;
    out.push({
      fact,
      category: (FACT_CATEGORIES as readonly string[]).includes(cat) ? cat : "other",
      importance: Number.isFinite(importance) ? Math.min(1, Math.max(0, importance)) : 0.5,
      replaces,
    });
    if (out.length >= 6) break;
  }
  return out;
}

/** Facts that are new (not a near-duplicate of a known one). */
export function newFactsOnly(candidates: UserFact[], known: UserFact[]): UserFact[] {
  const knownSets = known.map((k) => tokenSet(k.fact));
  return candidates.filter((c) => {
    const s = tokenSet(c.fact);
    return !knownSets.some((k) => jaccard(k, s) >= SAME_FACT_JACCARD);
  });
}

/** Known fact a candidate's `replaces` points at (exact or near match). */
export function findReplacedFact(candidate: UserFact, known: UserFact[]): UserFact | null {
  if (!candidate.replaces) return null;
  const target = normalizeText(candidate.replaces);
  const exact = known.find((k) => normalizeText(k.fact) === target);
  if (exact) return exact;
  const t = tokenSet(candidate.replaces);
  let best: UserFact | null = null;
  let bestScore = 0;
  for (const k of known) {
    const s = jaccard(t, tokenSet(k.fact));
    if (s > bestScore) {
      bestScore = s;
      best = k;
    }
  }
  return bestScore >= 0.6 ? best : null;
}

export function factDedupeKey(characterId: string, fact: string): string {
  return `fact:${characterId}:${shortHash(normalizeText(fact))}`;
}

/** Latest non-retracted user facts for this user + companion. */
export async function loadUserFacts(userId: string, characterId: string, limit = 40): Promise<UserFact[]> {
  const { rows } = await getPool().query<{
    id: string;
    content: string;
    payload: Record<string, unknown> | null;
    emotional_weight: number;
    occurred_at: string;
  }>(
    `SELECT e.id, e.content, e.payload, e.emotional_weight, e.occurred_at
       FROM memory_events e
      WHERE e.user_id = $1 AND e.character_id = $2
        AND e.event_type = 'note' AND e.payload ->> 'kind' = $3
        AND NOT EXISTS (
          SELECT 1 FROM memory_events r
           WHERE r.event_type = 'retraction' AND r.user_id = e.user_id
             AND r.payload ->> 'target_event_id' = e.id::text)
      ORDER BY e.occurred_at DESC
      LIMIT $4`,
    [userId, characterId, USER_FACT_KIND, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    fact: r.content,
    category: (String(r.payload?.category || "other") as FactCategory),
    importance: Number(r.emotional_weight) || 0.5,
    occurredAt: new Date(r.occurred_at).toISOString(),
  }));
}

/** Append new facts; a superseded fact gets a retraction event. */
export async function storeUserFacts(args: {
  userId: string;
  characterId: string;
  sessionId: string;
  turnId?: string | null;
  facts: UserFact[];
  known: UserFact[];
}): Promise<number> {
  let stored = 0;
  for (const f of newFactsOnly(args.facts, args.known)) {
    const replaced = findReplacedFact(f, args.known);
    const id = await appendMemoryEvent({
      userId: args.userId,
      characterId: args.characterId,
      eventType: "note",
      content: f.fact,
      payload: { kind: USER_FACT_KIND, category: f.category, turn_id: args.turnId ?? null, replaces_event_id: replaced?.id ?? null },
      emotionalWeight: f.importance,
      conversationId: args.sessionId,
      dedupeKey: factDedupeKey(args.characterId, f.fact),
      source: "mind",
    });
    if (!id) continue;
    stored += 1;
    if (replaced?.id) {
      await appendMemoryEvent(
        {
          userId: args.userId,
          characterId: args.characterId,
          eventType: "retraction",
          content: `Superseded: ${replaced.fact}`.slice(0, 400),
          payload: { target_event_id: replaced.id, reason: "superseded", by_event_id: id },
          dedupeKey: `retract:${replaced.id}`,
          source: "mind",
        },
        { embed: false },
      );
    }
  }
  return stored;
}
