/**
 * (A1) Starter memories: when a companion is created, her backstory and first
 * facts are written into companion_memories (policy facts, about=companion)
 * plus one `milestone` memory_event seed, so the very first chat knows her.
 *
 * (A6) Protected identity proposals: accept / reject / edit. An accepted (or
 * edited-then-accepted) proposal becomes a new append-only identity core
 * version (append_identity_version) and is fed back to the prompt's identity
 * lock via acceptedIdentityLines(). Rejected proposals become forgotten
 * markers so consolidation never proposes them again.
 */
import { and, eq } from "drizzle-orm";
import { companionMemories } from "@workspace/db";
import {
  isForgottenFact,
  isPolicyFact,
  policyDedupeKey,
  policyFactId,
  withCompanionMemoryLock,
  type ForgottenFact,
  type PolicyFact,
} from "./memoryPolicy";
import { groupCompanionMemories, cleanMemoryText, type MemoryChangeResult } from "./companionMemoryReview";
import { appendIdentityVersion, appendMemoryEvent, currentIdentity, ensureIdentitySnapshot } from "./memoryCore/memoryCore";
import { canonicalCompanionName } from "./companions/builtIn";

export const STARTER_SOURCE = "starter";
export const STARTER_MAX_FACTS = 6;
const SENTENCE_MAX = 280;

type CharacterLike = Record<string, unknown> & { id?: unknown; name?: unknown };

function clean(v: unknown, max = SENTENCE_MAX): string {
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
}
function isTodo(s: string): boolean {
  return /^TODO\b|TODO\(user\)/i.test(s);
}
function sentences(text: string, max: number): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 12 && !isTodo(s))
    .slice(0, max);
}

function starterFact(name: string, predicate: string, object: string, text: string, importance: number, now: string, core = false): PolicyFact {
  const key = policyDedupeKey({ about: "companion", subject: name, predicate, object });
  return {
    type: "factual",
    memory_class: core ? "core" : "semantic",
    text,
    subject: name,
    predicate,
    object,
    about: "companion",
    importance,
    confidence: 1,
    emotional_weight: 0.3,
    identity_relevant: true,
    // Creator-supplied identity is already accepted, so it is protected but not a proposal.
    protected: core,
    proposal: false,
    fact_id: policyFactId(key),
    created_at: now,
    ...({ source: STARTER_SOURCE, ...(core ? { accepted_at: now } : {}) } as Record<string, unknown>),
  } as PolicyFact;
}

/** Pure: the first facts a newly created companion knows about herself. */
export function buildStarterFacts(character: CharacterLike, now = new Date().toISOString()): PolicyFact[] {
  const name = canonicalCompanionName(clean(character.name, 80) || "Companion");
  const out: PolicyFact[] = [];
  const tagline = clean(character.tagline);
  const archetype = clean(character.archetype, 160);
  const personality = clean(character.personality, 400);
  const backstory = clean(character.backstory, 2000);
  const universe = clean(character.universe, 80);
  out.push(starterFact(name, "is named", name, `My name is ${name}.`, 0.9, now, true));
  if (archetype && !isTodo(archetype)) out.push(starterFact(name, "is", archetype, `I am ${archetype.replace(/^an?\s+/i, (m) => m.toLowerCase())}.`, 0.8, now, true));
  if (universe && universe !== "Anima") out.push(starterFact(name, "comes from", universe, `I come from ${universe}.`, 0.6, now));
  if (tagline && !isTodo(tagline)) out.push(starterFact(name, "tagline", tagline, tagline, 0.6, now));
  if (personality && !isTodo(personality)) {
    const first = sentences(personality, 1)[0] || personality.slice(0, SENTENCE_MAX);
    out.push(starterFact(name, "personality", first, first, 0.75, now));
  }
  for (const s of sentences(backstory, 3)) out.push(starterFact(name, "backstory", s, s, 0.7, now));
  const seen = new Set<string>();
  return out.filter((f) => (seen.has(f.fact_id) ? false : (seen.add(f.fact_id), true))).slice(0, STARTER_MAX_FACTS);
}

/** Pure merge: append starter facts not already present (by fact_id); idempotent. */
export function mergeStarterFacts(existing: unknown[], starter: PolicyFact[]): { facts: unknown[]; added: number } {
  const ids = new Set(existing.filter((f) => isPolicyFact(f) || isForgottenFact(f)).map((f) => (f as { fact_id: string }).fact_id));
  const add = starter.filter((f) => !ids.has(f.fact_id));
  return { facts: [...existing, ...add], added: add.length };
}

export async function seedStarterMemories(input: { userId: string; character: CharacterLike }): Promise<{ added: number }> {
  const userId = input.userId.trim();
  const characterId = input.character?.id != null ? String(input.character.id).trim() : "";
  if (!userId || !characterId) return { added: 0 };
  const starter = buildStarterFacts(input.character);
  const added = await withCompanionMemoryLock(userId, characterId, async (tx) => {
    const [row] = await tx
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    const { facts, added } = mergeStarterFacts(Array.isArray(row?.facts) ? row.facts : [], starter);
    if (!added) return 0;
    const now = new Date();
    await tx
      .insert(companionMemories)
      .values({ userId, characterId, summary: row?.summary ?? "", facts: facts as Record<string, unknown>[], emotionalState: row?.emotionalState ?? {}, resonanceNotes: row?.resonanceNotes ?? "", updatedAt: now })
      .onConflictDoUpdate({ target: [companionMemories.userId, companionMemories.characterId], set: { facts: facts as Record<string, unknown>[], updatedAt: now } });
    return added;
  });
  if (added) {
    // Memory-core layer: identity v1 snapshot + one append-only seed event (deduped).
    await ensureIdentitySnapshot(userId, input.character as { id: unknown }).catch(() => null);
    await appendMemoryEvent(
      {
        userId,
        characterId,
        eventType: "milestone",
        content: `${starter[0]?.subject || "She"} came into being. ${starter.map((f) => f.text).join(" ")}`.slice(0, 2000),
        payload: { kind: "starter_memories", fact_ids: starter.map((f) => f.fact_id) },
        emotionalWeight: 0.6,
        dedupeKey: `starter:${characterId}`,
      },
      { embed: true },
    ).catch(() => {});
  }
  return { added };
}

// ── (A6) proposals ───────────────────────────────────────────────────────────

export type ProposalAction = "accept" | "reject" | "edit";

function findProposal(facts: unknown[], factId: string): PolicyFact | undefined {
  return facts.find((f): f is PolicyFact => isPolicyFact(f) && f.fact_id === factId && f.proposal === true);
}

/**
 * Pure. accept → proposal becomes an accepted core fact (protected, proposal
 * false, accepted_at). edit → same, with the user's text. reject → removed and
 * replaced by a forgotten marker so it is never proposed again.
 */
export function resolveIdentityProposal(
  facts: unknown[],
  factId: string,
  action: ProposalAction,
  text?: unknown,
  now = new Date().toISOString(),
): (MemoryChangeResult & { facts?: unknown[]; accepted?: PolicyFact }) {
  const fact = findProposal(facts, factId);
  if (!fact) return { ok: false, status: 404, error: "No proposal like that was found.", code: "proposal_not_found" };
  if (action === "reject") {
    const marker: ForgottenFact = {
      forgotten: true,
      fact_id: fact.fact_id,
      about: fact.about,
      subject: fact.subject,
      predicate: fact.predicate,
      object: fact.object,
      deleted_at: now,
      turn_id: fact.turn_id,
      source_text: fact.text,
    } as ForgottenFact;
    const next = [...facts.filter((f) => !(isPolicyFact(f) && f.fact_id === factId)), marker];
    return { ok: true, changed: true, review: groupCompanionMemories(next), facts: next };
  }
  let nextText = fact.text;
  if (action === "edit") {
    const t = cleanMemoryText(text);
    if (!t) return { ok: false, status: 400, error: "Write the proposal in one short sentence.", code: "proposal_text_invalid" };
    nextText = t;
  }
  const accepted = {
    ...fact,
    text: nextText,
    memory_class: "core",
    protected: true,
    proposal: false,
    user_edited: action === "edit" ? true : fact.user_edited,
    ...({ accepted_at: now } as Record<string, unknown>),
    updated_at: now,
  } as PolicyFact;
  const next = facts.map((f) => (isPolicyFact(f) && f.fact_id === factId ? accepted : f));
  return { ok: true, changed: true, review: groupCompanionMemories(next), facts: next, accepted };
}

export { acceptedIdentityLines } from "./identityProposals";

export async function applyIdentityProposal(input: {
  userId: string;
  characterId: string;
  factId: string;
  action: ProposalAction;
  text?: unknown;
}): Promise<MemoryChangeResult & { identity_version?: number }> {
  const userId = input.userId.trim();
  const characterId = input.characterId.trim();
  if (!userId || !characterId || !input.factId.trim()) {
    return { ok: false, status: 400, error: "That proposal could not be found.", code: "proposal_not_found" };
  }
  const result = await withCompanionMemoryLock(userId, characterId, async (tx) => {
    const [row] = await tx
      .select()
      .from(companionMemories)
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
      .limit(1);
    if (!row) return { ok: false as const, status: 404 as const, error: "No proposal like that was found.", code: "proposal_not_found" };
    const r = resolveIdentityProposal(Array.isArray(row.facts) ? row.facts : [], input.factId.trim(), input.action, input.text);
    if (!r.ok || !r.facts) return r;
    await tx
      .update(companionMemories)
      .set({ facts: r.facts as Record<string, unknown>[], updatedAt: new Date() })
      .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)));
    return r;
  });
  if (!result.ok || !("accepted" in result) || !result.accepted) {
    const { facts: _f, accepted: _a, ...rest } = result as typeof result & { facts?: unknown; accepted?: unknown };
    return rest as MemoryChangeResult;
  }
  const accepted = result.accepted;
  const prior = await currentIdentity(userId, characterId).catch(() => null);
  const traits = Array.isArray(prior?.core_traits) ? prior!.core_traits : [];
  const identity = await appendIdentityVersion({
    userId,
    characterId,
    name: prior?.name || canonicalCompanionName(accepted.subject || "Companion"),
    personalityMatrix: prior?.personality_matrix ?? {},
    voice: prior?.voice ?? {},
    coreTraits: [...traits, { text: accepted.text, fact_id: accepted.fact_id, accepted_at: (accepted as Record<string, unknown>).accepted_at }],
    relationships: prior?.relationships ?? {},
    backstory: prior?.backstory ?? "",
    source: "app",
    changeNote: `${input.action === "edit" ? "edited + accepted" : "accepted"} identity proposal: ${accepted.text}`.slice(0, 300),
  }).catch(() => null);
  return { ok: true, changed: true, review: result.review, identity_version: identity?.version };
}
