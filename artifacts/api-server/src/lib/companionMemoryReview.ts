/**
 * Review, correct, and forget facts already stored on companion_memories.
 *
 * This does not call a model and does not write mood, summary, persona,
 * backstory, or the operator model. Core proposals stay read-only.
 * User facts stay in their own list, even if someone rewrites the sentence.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import {
  companionMemories,
  db,
  memoryEmbeddings,
  withTransientDbRetry,
} from "@workspace/db";
import { factIdFor } from "./memoryEmbeddings";
import {
  isPolicyFact,
  type MemoryAbout,
  type MemoryClass,
  type PolicyFact,
} from "./memoryPolicy";

export const MEMORY_TEXT_MAX = 500;

export type MemoryReviewSection = "about_you" | "companion" | "core";

export type CompanionMemoryReviewItem = {
  fact_id: string;
  text: string;
  section: MemoryReviewSection;
  kind_label: string;
  importance_hint: string | null;
  about: MemoryAbout;
  memory_class: MemoryClass;
  protected: boolean;
  editable: boolean;
  created_at: string | null;
};

export type CompanionMemoryReview = {
  about_you: CompanionMemoryReviewItem[];
  companion: CompanionMemoryReviewItem[];
  core: CompanionMemoryReviewItem[];
};

export type MemoryChangeResult =
  | { ok: true; review: CompanionMemoryReview; changed: boolean }
  | { ok: false; status: 400 | 403 | 404; error: string; code: string };

const EMPTY_REVIEW: CompanionMemoryReview = {
  about_you: [],
  companion: [],
  core: [],
};

export function cleanMemoryText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  if (!text || text.length > MEMORY_TEXT_MAX) return null;
  return text;
}

export function memoryFactLocked(fact: PolicyFact): boolean {
  return fact.memory_class === "core" || fact.protected === true || fact.proposal === true;
}

/** User facts never share a section with the companion's own facts. */
export function memoryReviewSection(fact: PolicyFact): MemoryReviewSection {
  if (fact.about === "user") return "about_you";
  if (fact.memory_class === "core" || fact.proposal === true) return "core";
  return "companion";
}

function importanceHint(importance: number): string {
  if (importance >= 0.75) return "She holds onto this";
  if (importance >= 0.45) return "Worth remembering";
  return "A light note";
}

function kindLabel(fact: PolicyFact, section: MemoryReviewSection): string {
  if (section === "core") return "Identity proposal";
  if (fact.about === "user") {
    return fact.memory_class === "episodic" ? "A moment with you" : "Something about you";
  }
  return fact.memory_class === "episodic" ? "Something that happened" : "Something she knows";
}

function toReviewItem(fact: PolicyFact): CompanionMemoryReviewItem {
  const section = memoryReviewSection(fact);
  const locked = memoryFactLocked(fact);
  return {
    fact_id: fact.fact_id,
    text: fact.text,
    section,
    kind_label: kindLabel(fact, section),
    importance_hint: section === "core" || locked ? null : importanceHint(fact.importance),
    about: fact.about,
    memory_class: fact.memory_class,
    protected: locked,
    editable:
      !locked &&
      (fact.memory_class === "episodic" || fact.memory_class === "semantic"),
    created_at: fact.created_at || null,
  };
}

function byImportanceThenNewest(a: PolicyFact, b: PolicyFact): number {
  if (b.importance !== a.importance) return b.importance - a.importance;
  const aTime = Date.parse(a.created_at || "") || 0;
  const bTime = Date.parse(b.created_at || "") || 0;
  return bTime - aTime;
}

/**
 * Policy facts only. Recent turn crumbs mix the human and the companion in
 * one line, so they stay out of this screen.
 */
export function groupCompanionMemories(facts: unknown): CompanionMemoryReview {
  if (!Array.isArray(facts)) return { ...EMPTY_REVIEW };
  const policy = facts.filter(isPolicyFact);
  const aboutYou = policy
    .filter((fact) => memoryReviewSection(fact) === "about_you")
    .sort(byImportanceThenNewest)
    .map(toReviewItem);
  const companion = policy
    .filter((fact) => memoryReviewSection(fact) === "companion")
    .sort(byImportanceThenNewest)
    .map(toReviewItem);
  const core = policy
    .filter((fact) => memoryReviewSection(fact) === "core")
    .sort(byImportanceThenNewest)
    .map(toReviewItem);
  return { about_you: aboutYou, companion, core };
}

function findPolicyFact(facts: unknown[], factId: string): PolicyFact | undefined {
  return facts.find((item): item is PolicyFact => isPolicyFact(item) && item.fact_id === factId);
}

function lockedResult(): MemoryChangeResult {
  return {
    ok: false,
    status: 403,
    error: "This memory is protected and can't be changed.",
    code: "memory_protected",
  };
}

export function editCompanionMemoryFact(
  facts: unknown[],
  factId: string,
  nextText: unknown,
  now = new Date().toISOString(),
): MemoryChangeResult & { facts?: unknown[] } {
  const fact = findPolicyFact(facts, factId);
  if (!fact) {
    return {
      ok: false,
      status: 404,
      error: "No memory like that was found.",
      code: "memory_not_found",
    };
  }
  if (memoryFactLocked(fact)) return lockedResult();
  if (fact.memory_class !== "episodic" && fact.memory_class !== "semantic") {
    return lockedResult();
  }
  const text = cleanMemoryText(nextText);
  if (!text) {
    return {
      ok: false,
      status: 400,
      error: "Write a short sentence to correct this memory.",
      code: "memory_text_invalid",
    };
  }
  if (text === fact.text.trim()) {
    return { ok: true, changed: false, review: groupCompanionMemories(facts), facts };
  }
  const next = facts.map((item) => {
    if (!isPolicyFact(item) || item.fact_id !== factId) return item;
    return { ...item, text, updated_at: now };
  });
  return { ok: true, changed: true, review: groupCompanionMemories(next), facts: next };
}

export function deleteCompanionMemoryFact(
  facts: unknown[],
  factId: string,
): MemoryChangeResult & { facts?: unknown[] } {
  const fact = findPolicyFact(facts, factId);
  if (!fact) {
    return {
      ok: false,
      status: 404,
      error: "No memory like that was found.",
      code: "memory_not_found",
    };
  }
  if (memoryFactLocked(fact)) return lockedResult();
  if (fact.memory_class !== "episodic" && fact.memory_class !== "semantic") {
    return lockedResult();
  }
  const next = facts.filter((item) => !(isPolicyFact(item) && item.fact_id === factId));
  return { ok: true, changed: true, review: groupCompanionMemories(next), facts: next };
}

function idOk(value: string, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max && !/\s/.test(trimmed);
}

async function dropFactEmbeddings(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  characterId: string,
  factIds: string[],
): Promise<void> {
  const ids = [...new Set(factIds.map((id) => id.trim()).filter(Boolean))];
  if (ids.length === 0) return;
  await tx
    .delete(memoryEmbeddings)
    .where(
      and(
        eq(memoryEmbeddings.userId, userId),
        eq(memoryEmbeddings.characterId, characterId),
        inArray(memoryEmbeddings.factId, ids),
      ),
    );
}

/**
 * Writes only `facts` on the caller's companion_memories row.
 * Mood, summary, resonance notes, and every other table stay untouched.
 */
export async function applyCompanionMemoryChange(input: {
  userId: string;
  characterId: string;
  factId: string;
  action: "edit" | "delete";
  text?: unknown;
}): Promise<MemoryChangeResult> {
  const userId = input.userId.trim();
  const characterId = input.characterId.trim();
  const factId = input.factId.trim();
  if (!userId) {
    return { ok: false, status: 404, error: "No memory like that was found.", code: "memory_not_found" };
  }
  if (!idOk(characterId, 200) || !idOk(factId, 128)) {
    return { ok: false, status: 400, error: "That memory could not be found.", code: "memory_not_found" };
  }

  return withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${characterId}`}))`);
      const [existing] = await tx
        .select()
        .from(companionMemories)
        .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)))
        .limit(1);
      if (!existing) {
        return {
          ok: false as const,
          status: 404 as const,
          error: "No memory like that was found.",
          code: "memory_not_found",
        };
      }
      const current = Array.isArray(existing.facts) ? existing.facts : [];
      const prior = findPolicyFact(current, factId);
      const changed =
        input.action === "delete"
          ? deleteCompanionMemoryFact(current, factId)
          : editCompanionMemoryFact(current, factId, input.text);
      if (!changed.ok || !changed.changed || !changed.facts) return changed;

      await tx
        .update(companionMemories)
        .set({
          facts: changed.facts as Record<string, unknown>[],
          updatedAt: new Date(),
        })
        .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, characterId)));

      const embeddingIds = [factId];
      if (prior?.text) embeddingIds.push(factIdFor(prior.text));
      if (input.action === "edit") {
        const cleaned = cleanMemoryText(input.text);
        if (cleaned) embeddingIds.push(factIdFor(cleaned));
      }
      await dropFactEmbeddings(tx, userId, characterId, embeddingIds);
      return changed;
    }),
  );
}
