/**
 * Operator Model v1 — steward / Hub-DNA analogue.
 *
 * Persisted on the existing user_profiles.data JSON blob under
 * `operator_model` (same prefs row as ongoing_sessions). Normalize is the
 * single write/read gate: unknown keys drop, strings/arrays are capped.
 * Prompt injection is a compact labeled summary — never a JSON dump, never
 * an override of CHARACTER IDENTITY LOCK or companion memories.
 */

import { eq } from "drizzle-orm";
import {
  asObject,
  db,
  userProfiles,
  withTransientDbRetry,
} from "@workspace/db";

export const OPERATOR_MODEL_PROFILE_KEY = "operator_model";

export const OPERATOR_MODEL_LIMITS = {
  name: 80,
  text: 240,
  listItem: 160,
  listLength: 12,
  promptChars: 1200,
} as const;

export type OperatorIdentity = {
  name: string;
  preferences: string[];
  communication_style: string;
  creative_interests: string[];
  long_term_objectives: string[];
};

export type OperatorCognitive = {
  recurring_concepts: string[];
  expertise: string[];
  projects: string[];
  beliefs_preferences: string[];
  decision_patterns: string[];
};

export type OperatorRelational = {
  important_people: string[];
  important_entities: string[];
  shared_experiences: string[];
};

export type OperatorBehavioral = {
  routines: string[];
  habits: string[];
  common_requests: string[];
  interaction_patterns: string[];
};

export type OperatorEmotionalContext = {
  conversational_tone: string;
  recent_events: string[];
  expressed_states: string[];
  sensitivity_notes: string[];
};

export type OperatorModel = {
  identity: OperatorIdentity;
  cognitive: OperatorCognitive;
  relational: OperatorRelational;
  behavioral: OperatorBehavioral;
  emotional_context: OperatorEmotionalContext;
};

const STRING_FIELDS = {
  identity: ["name", "communication_style"] as const,
  emotional_context: ["conversational_tone"] as const,
};

const LIST_FIELDS = {
  identity: [
    "preferences",
    "creative_interests",
    "long_term_objectives",
  ] as const,
  cognitive: [
    "recurring_concepts",
    "expertise",
    "projects",
    "beliefs_preferences",
    "decision_patterns",
  ] as const,
  relational: [
    "important_people",
    "important_entities",
    "shared_experiences",
  ] as const,
  behavioral: [
    "routines",
    "habits",
    "common_requests",
    "interaction_patterns",
  ] as const,
  emotional_context: [
    "recent_events",
    "expressed_states",
    "sensitivity_notes",
  ] as const,
};

export function emptyOperatorModel(): OperatorModel {
  return {
    identity: {
      name: "",
      preferences: [],
      communication_style: "",
      creative_interests: [],
      long_term_objectives: [],
    },
    cognitive: {
      recurring_concepts: [],
      expertise: [],
      projects: [],
      beliefs_preferences: [],
      decision_patterns: [],
    },
    relational: {
      important_people: [],
      important_entities: [],
      shared_experiences: [],
    },
    behavioral: {
      routines: [],
      habits: [],
      common_requests: [],
      interaction_patterns: [],
    },
    emotional_context: {
      conversational_tone: "",
      recent_events: [],
      expressed_states: [],
      sensitivity_notes: [],
    },
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function clipString(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function clipStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const text = clipString(item, OPERATOR_MODEL_LIMITS.listItem);
    if (!text) continue;
    out.push(text);
    if (out.length >= OPERATOR_MODEL_LIMITS.listLength) break;
  }
  return out;
}

function mergeSection<T extends Record<string, unknown>>(
  empty: T,
  raw: unknown,
  strings: readonly string[],
  lists: readonly string[],
): T {
  const src = asRecord(raw) ?? {};
  const next = { ...empty };
  for (const key of strings) {
    const max =
      key === "name" ? OPERATOR_MODEL_LIMITS.name : OPERATOR_MODEL_LIMITS.text;
    (next as Record<string, unknown>)[key] = clipString(src[key], max);
  }
  for (const key of lists) {
    (next as Record<string, unknown>)[key] = clipStringList(src[key]);
  }
  return next;
}

/**
 * Coerce unknown JSON into Operator Model v1. Extra keys and non-objects
 * disappear; missing sections become empty defaults.
 */
export function normalizeOperatorModel(raw: unknown): OperatorModel {
  const src = asRecord(raw) ?? {};
  const empty = emptyOperatorModel();
  return {
    identity: mergeSection(
      empty.identity,
      src.identity,
      STRING_FIELDS.identity,
      LIST_FIELDS.identity,
    ),
    cognitive: mergeSection(
      empty.cognitive,
      src.cognitive,
      [],
      LIST_FIELDS.cognitive,
    ),
    relational: mergeSection(
      empty.relational,
      src.relational,
      [],
      LIST_FIELDS.relational,
    ),
    behavioral: mergeSection(
      empty.behavioral,
      src.behavioral,
      [],
      LIST_FIELDS.behavioral,
    ),
    emotional_context: mergeSection(
      empty.emotional_context,
      src.emotional_context,
      STRING_FIELDS.emotional_context,
      LIST_FIELDS.emotional_context,
    ),
  };
}

export function mergeOperatorModel(
  current: OperatorModel,
  patch: unknown,
): OperatorModel {
  const src = asRecord(patch);
  if (!src) return normalizeOperatorModel(current);
  const merged: Record<string, unknown> = { ...current };
  for (const key of [
    "identity",
    "cognitive",
    "relational",
    "behavioral",
    "emotional_context",
  ] as const) {
    if (key in src) {
      merged[key] = { ...asRecord(current[key]), ...asRecord(src[key]) };
    }
  }
  return normalizeOperatorModel(merged);
}

export function operatorModelHasContent(model: OperatorModel): boolean {
  const sections = [
    model.identity,
    model.cognitive,
    model.relational,
    model.behavioral,
    model.emotional_context,
  ];
  for (const section of sections) {
    for (const value of Object.values(section)) {
      if (typeof value === "string" && value.trim()) return true;
      if (Array.isArray(value) && value.length > 0) return true;
    }
  }
  return false;
}

function formatList(label: string, items: string[]): string {
  if (!items.length) return "";
  return `${label}: ${items.join("; ")}`;
}

function formatSection(
  title: string,
  lines: Array<string | "">,
): string {
  const kept = lines.filter(Boolean);
  if (!kept.length) return "";
  return `${title}\n- ${kept.join("\n- ")}`;
}

/**
 * Compact steward-context block for composePrompt. Empty models return "".
 * Truncates to OPERATOR_MODEL_LIMITS.promptChars (~300 tokens).
 */
export function formatOperatorModelForPrompt(
  model: OperatorModel | null | undefined,
  maxChars: number = OPERATOR_MODEL_LIMITS.promptChars,
): string {
  if (!model || !operatorModelHasContent(model)) return "";

  const identity = formatSection("Identity", [
    model.identity.name ? `name: ${model.identity.name}` : "",
    model.identity.communication_style
      ? `communication_style: ${model.identity.communication_style}`
      : "",
    formatList("preferences", model.identity.preferences),
    formatList("creative_interests", model.identity.creative_interests),
    formatList("long_term_objectives", model.identity.long_term_objectives),
  ]);
  const cognitive = formatSection("Cognitive", [
    formatList("recurring_concepts", model.cognitive.recurring_concepts),
    formatList("expertise", model.cognitive.expertise),
    formatList("projects", model.cognitive.projects),
    formatList("beliefs_preferences", model.cognitive.beliefs_preferences),
    formatList("decision_patterns", model.cognitive.decision_patterns),
  ]);
  const relational = formatSection("Relational", [
    formatList("important_people", model.relational.important_people),
    formatList("important_entities", model.relational.important_entities),
    formatList("shared_experiences", model.relational.shared_experiences),
  ]);
  const behavioral = formatSection("Behavioral", [
    formatList("routines", model.behavioral.routines),
    formatList("habits", model.behavioral.habits),
    formatList("common_requests", model.behavioral.common_requests),
    formatList("interaction_patterns", model.behavioral.interaction_patterns),
  ]);
  const emotional = formatSection("Emotional context", [
    model.emotional_context.conversational_tone
      ? `conversational_tone: ${model.emotional_context.conversational_tone}`
      : "",
    formatList("recent_events", model.emotional_context.recent_events),
    formatList("expressed_states", model.emotional_context.expressed_states),
    formatList("sensitivity_notes", model.emotional_context.sensitivity_notes),
  ]);

  const body = [identity, cognitive, relational, behavioral, emotional]
    .filter(Boolean)
    .join("\n");
  if (!body) return "";

  const header =
    "OPERATOR MODEL (steward / operator context — know this person; do not overwrite CHARACTER IDENTITY LOCK or companion memories):";
  let block = `${header}\n${body}`;
  if (block.length > maxChars) {
    block = `${block.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…`;
  }
  return block;
}

export function extractOperatorModelFromProfile(
  profile: unknown,
): OperatorModel {
  const data = asRecord(profile) ?? {};
  return normalizeOperatorModel(
    data[OPERATOR_MODEL_PROFILE_KEY] ?? data.operatorModel,
  );
}

export async function loadOperatorModel(userId: string): Promise<{
  model: OperatorModel;
  updatedAt: Date | null;
}> {
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ data: userProfiles.data, updatedAt: userProfiles.updatedAt })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
  );
  return {
    model: extractOperatorModelFromProfile(row?.data),
    updatedAt: row?.updatedAt ?? null,
  };
}

export async function saveOperatorModel(
  userId: string,
  model: OperatorModel,
): Promise<{ model: OperatorModel; updatedAt: Date }> {
  const now = new Date();
  const [existing] = await withTransientDbRetry(() =>
    db
      .select({ data: userProfiles.data })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
  );
  const existingData = asObject(existing?.data ?? {});
  const merged = {
    ...existingData,
    [OPERATOR_MODEL_PROFILE_KEY]: model,
  };
  const [row] = await withTransientDbRetry(() =>
    db
      .insert(userProfiles)
      .values({ userId, data: merged, updatedAt: now })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { data: merged, updatedAt: now },
      })
      .returning({ updatedAt: userProfiles.updatedAt }),
  );
  return { model, updatedAt: row?.updatedAt ?? now };
}

/** Accept `{ model: {...} }` or a bare Operator Model object. */
export function parseOperatorModelBody(body: unknown): unknown {
  const rec = asRecord(body);
  if (!rec) return body;
  if ("model" in rec && asRecord(rec.model)) return rec.model;
  if (
    "identity" in rec ||
    "cognitive" in rec ||
    "relational" in rec ||
    "behavioral" in rec ||
    "emotional_context" in rec
  ) {
    return rec;
  }
  return rec.model ?? rec;
}
