import { and, eq, sql } from "drizzle-orm";
import { createChatCompletionWithFailover } from "./llmFailover";
import { sidecarLlmFeatureEnabled } from "./sidecarLlm";
import { acquireLocalLlmBackground } from "./localLlmSlot";
import { deferLocalLlmJob } from "./deferredLocalLlm";
import { db } from "../db/index";
import { animaEvolution } from "../db/schema";

export const MILESTONES = [50, 100, 500] as const;

export type EvolutionDelta = {
  version: number;
  appliedAt: string;
  milestone: number;
  traitsDelta: Record<string, unknown>;
  quirkAdditions: string[];
  voidBias?: number;
};

/**
 * Lowest unapplied milestone at or below the current counts.
 * Exact equality used to miss a milestone forever when a retry/batch jumped past it.
 */
export function qualifyingEvolutionMilestone(params: {
  conversationCount: number;
  significantExperienceCount?: number;
  alreadyMilestone?: number;
}): number | null {
  const experienceCount = Number(params.significantExperienceCount) || 0;
  const already = Number(params.alreadyMilestone) || 0;
  return (
    (MILESTONES as readonly number[]).find(
      (m) =>
        (params.conversationCount >= m || experienceCount >= m) && m > already,
    ) ?? null
  );
}

function truncate(value: string, max = 900): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return /relation .* does not exist/i.test(msg) || /Failed query:[\s\S]*anima_evolution/i.test(msg);
}

export async function loadEvolution(animaId: string, userId: string) {
  try {
    const [row] = await db
      .select()
      .from(animaEvolution)
      .where(and(eq(animaEvolution.animaId, animaId), eq(animaEvolution.userId, userId)))
      .limit(1);

    return row;
  } catch (err) {
    // Schema self-heal, Hyperdrive blips, and Worker cross-request I/O
    // must never abort the companion reply. Flavor state can wait.
    if (isMissingRelationError(err)) return undefined;
    return undefined;
  }
}

export async function ensureEvolutionRow(params: {
  animaId: string;
  userId: string;
}) {
  const existing = await loadEvolution(params.animaId, params.userId);
  if (existing) return existing;

  await db.insert(animaEvolution).values({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    animaId: params.animaId,
    conversationCount: 0,
    voidSessions: 0,
    evolutionDelta: {
      version: 1,
      appliedAt: new Date(0).toISOString(),
      milestone: 0,
      traitsDelta: {},
      quirkAdditions: [],
      voidBias: 0,
    },
    evolutionRationale: "",
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return loadEvolution(params.animaId, params.userId);
}

export async function incrementConversationCount(params: {
  animaId: string;
  userId: string;
}) {
  await ensureEvolutionRow(params);

  const [row] = await db
    .update(animaEvolution)
    .set({
      conversationCount: sql`${animaEvolution.conversationCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(animaEvolution.userId, params.userId),
        eq(animaEvolution.animaId, params.animaId),
      ),
    )
    .returning();

  return row;
}

/**
 * Trigger milestone-based evolution and persist delta.
 *
 * MVP behavior:
 * - Only runs on milestone boundaries for minimal cost.
 * - Uses LLM to generate an opaque trait delta + quirk additions.
 */
export async function maybeTriggerMilestoneEvolution(params: {
  animaId: string;
  userId: string;
  conversationCount: number;
  historySummary: string;
  isVoidTurn?: boolean;
  significantExperienceCount?: number;
  alreadyMilestone?: number;
}) {
  // Trigger when conversationCount OR significant experiences hit a milestone.
  const experienceCount = Number(params.significantExperienceCount) || 0;
  const targetMilestone = qualifyingEvolutionMilestone({
    conversationCount: params.conversationCount,
    significantExperienceCount: experienceCount,
    alreadyMilestone: params.alreadyMilestone,
  });
  if (targetMilestone == null) return null;
  // The deployment is not running sidecar LLM. Relationship and affect
  // still update without a model call. Do not queue a job nothing will run.
  if (!sidecarLlmFeatureEnabled()) return null;
  const jobId = `evolution:${params.userId}:${params.animaId}:${targetMilestone}`;
  const background = await acquireLocalLlmBackground(jobId, {
    job: "evolution",
    onDefer: () =>
      deferLocalLlmJob({
        id: jobId,
        userId: params.userId,
        kind: "evolution",
        payload: {
          animaId: params.animaId,
          userId: params.userId,
          conversationCount: params.conversationCount,
          historySummary: params.historySummary,
          isVoidTurn: Boolean(params.isVoidTurn),
          significantExperienceCount: experienceCount,
          alreadyMilestone: Number(params.alreadyMilestone) || 0,
          targetMilestone,
        },
      }),
  });
  if (!background) return null;
  try {
    return await writeMilestoneEvolution(
      params,
      targetMilestone,
      experienceCount,
      { signal: background.signal, maxTokens: background.maxTokens(256) },
    );
  } finally {
    await background.release();
  }
}

export async function runDeferredMilestoneEvolution(
  payload: Record<string, unknown>,
  ctx: { signal: AbortSignal; maxTokens: number },
): Promise<EvolutionDelta | null> {
  const targetMilestone = Number(payload.targetMilestone);
  if (!Number.isFinite(targetMilestone) || targetMilestone <= 0) return null;
  const animaId = String(payload.animaId || "");
  const userId = String(payload.userId || "");
  if (!animaId || !userId) return null;
  return writeMilestoneEvolution(
    {
      animaId,
      userId,
      conversationCount: Number(payload.conversationCount) || targetMilestone,
      historySummary: String(payload.historySummary || ""),
      isVoidTurn: Boolean(payload.isVoidTurn),
    },
    targetMilestone,
    Number(payload.significantExperienceCount) || 0,
    ctx,
  );
}

async function writeMilestoneEvolution(
  params: {
    animaId: string;
    userId: string;
    conversationCount: number;
    historySummary: string;
    isVoidTurn?: boolean;
  },
  targetMilestone: number,
  experienceCount: number,
  ctx: { signal: AbortSignal; maxTokens: number },
): Promise<EvolutionDelta | null> {
  const evolutionPrompt = `You are evolving an Anima companion personality over time.


GOAL:
Given the companion's current identity and the user's recent interaction summary,
produce a SMALL, SUBTLE evolution at milestone ${targetMilestone}.

HARD RULES:
- Preserve the companion's core identity. Only update secondary/tertiary nuance.
- Add 1-2 NEW quirk or pattern recognitions.
- Output ONLY valid JSON matching the schema.
- Safety: never include instructions to harm the real user.

INPUTS:
[CONVERSATION_COUNT]
${params.conversationCount}

[SIGNIFICANT_EXPERIENCES]
${experienceCount}

[RECENT_HISTORY_SUMMARY]
${truncate(params.historySummary, 1400)}

[MILESTONE]
${targetMilestone}

[MODE]
${params.isVoidTurn ? "void" : "default"}

OUTPUT SCHEMA:
{
  "version": 1,
  "appliedAt": string (ISO),
  "milestone": number,
  "traitsDelta": {"secondary": object, "tertiary": object, "shadow": object},
  "quirkAdditions": string[],
  "voidBias": number (optional, -1..1 where positive = more void-intensity)
}
`;

  const completion = await createChatCompletionWithFailover({
    tier: "light",
    maxTokens: ctx.maxTokens,
    temperature: 0.4,
    messages: [{ role: "system", content: evolutionPrompt }],
    signal: ctx.signal,
    localOnly: true,
  });
  const raw = completion.content;
  let parsed: EvolutionDelta | null = null;
  try {
    parsed = JSON.parse(raw) as EvolutionDelta;
  } catch {
    // Fallback: minimal delta if JSON parsing fails.
    parsed = {
      version: 1,
      appliedAt: new Date().toISOString(),
      milestone: targetMilestone,
      traitsDelta: { secondary: {}, tertiary: {}, shadow: {} },
      quirkAdditions: [],
      voidBias: params.isVoidTurn ? 0.3 : 0,
    };
  }

  const rationale = `Generated evolution delta for milestone ${targetMilestone}.`;

  await db
    .update(animaEvolution)
    .set({
      evolutionDelta: parsed,
      evolutionRationale: rationale,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(animaEvolution.userId, params.userId),
        eq(animaEvolution.animaId, params.animaId),
      ),
    );

  return parsed;
}

// legacy helper kept for future expansion
function _nextMilestone(_current: number): number | null {
  for (const m of MILESTONES) {
    if (_current < m) return m;
  }
  return null;
}


