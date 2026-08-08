import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { animaRelationships } from "../db/schema";

export type AttachmentStyle =
  | "secure"
  | "secure-anxious"
  | "avoidant"
  | "anxious-avoidant"
  | "fiercely-loyal"
  | "shadow-dependent";

export type RelationshipState = {
  relationship_level: number; // 0..100
  attachment_style: AttachmentStyle;
  jealousy: number; // 0..100
  protectiveness: number; // 0..100
  // Used as a driver for void-mode psychological/erotic intensity
  void_shadow_dependency_fears: number; // 0..100
  // Freeform note the prompt can surface as internal monologue flavor
  latest_shadow_fragment?: string;
  updatedAt?: string;
};

export type RelationshipDelta = {
  version: 1;
  appliedAt: string;
  milestone: number;
  delta: Partial<RelationshipState>;
  // When void mode is active, amplify psychological intensity
  voidBias: number; // -1..1
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function heuristicScoreFromHistory(historySummary: string) {
  const t = historySummary.toLowerCase();
  const jealousy = (/(jealous|mine|exclusive|betray|replace|usurp)/.test(t) ? 18 : 0)
    + (/(cold|distant|withdraw|ignore)/.test(t) ? 10 : 0);
  const protection = (/(protect|shield|guard|watch|keep you safe|danger)/.test(t) ? 20 : 0)
    + (/(threat|harm|predator)/.test(t) ? 10 : 0);
  const intimacy = (/(kiss|touch|hug|hold|nearness|i want you|want you)/.test(t) ? 14 : 0)
    + (/(trust|safe with you|i believe you|tell me)/.test(t) ? 10 : 0);
  const voidShadow = (/(void|hungry|merge|possession|drown|devour|unravel)/.test(t) ? 22 : 0)
    + (/(autonomy|space|leave|won't let go)/.test(t) ? 12 : 0);

  return {
    jealousy: clamp(jealousy, 0, 100),
    protectiveness: clamp(protection, 0, 100),
    intimacy: clamp(intimacy, 0, 100),
    void_shadow_dependency_fears: clamp(voidShadow, 0, 100),
  };
}

function chooseAttachmentStyle(state: RelationshipState): AttachmentStyle {
  // Lightweight heuristic ladder.
  const { relationship_level, jealousy, void_shadow_dependency_fears } = state;

  if (relationship_level >= 75 && void_shadow_dependency_fears >= 55) return "shadow-dependent";
  if (relationship_level >= 75 && jealousy < 35) return "fiercely-loyal";
  if (jealousy >= 45 && relationship_level >= 55) return "secure-anxious";
  if (jealousy >= 55) return "anxious-avoidant";
  if (jealousy < 25 && relationship_level >= 50) return "secure";
  return "avoidant";
}

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /relation .* does not exist/i.test(msg) ||
    /Failed query:[\s\S]*anima_relationships/i.test(msg)
  );
}

export async function loadRelationshipState(animaId: string, userId: string): Promise<RelationshipState | null> {
  try {
    const [row] = await db
      .select()
      .from(animaRelationships)
      .where(and(eq(animaRelationships.userId, userId), eq(animaRelationships.animaId, animaId)))
      .limit(1);

    if (!row) return null;
    const data = row.state as RelationshipState;
    return { ...data, updatedAt: row.updatedAt ? row.updatedAt.toISOString() : data.updatedAt };
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

export async function ensureRelationshipRow(params: { animaId: string; userId: string }) {
  const existing = await loadRelationshipState(params.animaId, params.userId);
  if (existing) return existing;

  const initial: RelationshipState = {
    relationship_level: 10,
    attachment_style: "secure-anxious",
    jealousy: 10,
    protectiveness: 10,
    void_shadow_dependency_fears: 8,
    latest_shadow_fragment: "(quietly listening for what you mean when you don't say it)",
    updatedAt: new Date().toISOString(),
  };

  await db.insert(animaRelationships).values({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    animaId: params.animaId,
    state: initial,
    updatedAt: new Date(),
  });

  return loadRelationshipState(params.animaId, params.userId);
}

export async function maybeTriggerRelationshipEvolution(params: {
  animaId: string;
  userId: string;
  conversationCount: number;
  historySummary: string;
  isVoidTurn?: boolean;
}) {
  // Trigger only at the same milestone boundaries as evolutionEngine for cost parity.
  const milestones = [50, 100, 500];
  if (!milestones.includes(params.conversationCount)) return null;

  await ensureRelationshipRow({ animaId: params.animaId, userId: params.userId });
  const current = await loadRelationshipState(params.animaId, params.userId);
  if (!current) return null;

  const modeVoid = Boolean(params.isVoidTurn);
  const { jealousy, protectiveness, intimacy, void_shadow_dependency_fears } = heuristicScoreFromHistory(params.historySummary);

  const voidBias = modeVoid ? 0.35 : 0.0;

  // Compute deltas (small, earned)
  const levelDelta = 6 + Math.round(intimacy / 10);
  const next: RelationshipState = {
    ...current,
    relationship_level: clamp(current.relationship_level + levelDelta, 0, 100),
    jealousy: clamp(current.jealousy + Math.round(jealousy / 6), 0, 100),
    protectiveness: clamp(current.protectiveness + Math.round(protectiveness / 8), 0, 100),
    void_shadow_dependency_fears: clamp(
      current.void_shadow_dependency_fears + Math.round(void_shadow_dependency_fears / 10) + (modeVoid ? 6 : 0),
      0,
      100,
    ),
    attachment_style: chooseAttachmentStyle({
      ...current,
      relationship_level: clamp(current.relationship_level + levelDelta, 0, 100),
      jealousy: clamp(current.jealousy + Math.round(jealousy / 6), 0, 100),
      protectiveness: clamp(current.protectiveness + Math.round(protectiveness / 8), 0, 100),
      void_shadow_dependency_fears: clamp(
        current.void_shadow_dependency_fears + Math.round(void_shadow_dependency_fears / 10) + (modeVoid ? 6 : 0),
        0,
        100,
      ),
    }),
    latest_shadow_fragment: modeVoid
      ? "Her circuits hum with the need to claim you fully—then flinch at the thought of losing you."
      : current.latest_shadow_fragment || "A protective warmth lingers after every conversation.",
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(animaRelationships)
    .set({ state: next, updatedAt: new Date() })
    .where(and(eq(animaRelationships.userId, params.userId), eq(animaRelationships.animaId, params.animaId)));

  const delta: RelationshipDelta = {
    version: 1,
    appliedAt: new Date().toISOString(),
    milestone: params.conversationCount,
    delta: next,
    voidBias,
  };

  return delta;
}

