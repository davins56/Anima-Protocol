import { and, eq } from "drizzle-orm";
import { db } from "../db/index";
import { animaNarrativeArcs } from "../db/schema";

export type ArcStage = "Discovery" | "Deepening" | "Resonance Crisis" | "Fusion";

export type ArcState = {
  arc_stage: ArcStage;
  progress: number; // 0..100
  arc_name?: string;
  shared_quest_memory?: string[]; // lightweight for prompt injection
  updatedAt?: string;
};

export type ArcDelta = {
  version: 1;
  appliedAt: string;
  milestone: number;
  delta: Partial<ArcState>;
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

function detectArcStartIntent(content: string): { arc_name?: string } {
  const m = content.match(/start\s+arc\s*:\s*([^\n]+)$/i);
  if (!m) return {};
  return { arc_name: String(m[1]).trim().slice(0, 80) };
}

function stageFromProgress(progress: number): ArcStage {
  if (progress < 35) return "Discovery";
  if (progress < 70) return "Deepening";
  if (progress < 90) return "Resonance Crisis";
  return "Fusion";
}

function isMissingRelationError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err ?? "");
  return (
    /relation .* does not exist/i.test(msg) ||
    /Failed query:[\s\S]*anima_narrative_arcs/i.test(msg)
  );
}

export async function loadArcState(animaId: string, userId: string): Promise<ArcState | null> {
  try {
    const [row] = await db
      .select()
      .from(animaNarrativeArcs)
      .where(and(eq(animaNarrativeArcs.userId, userId), eq(animaNarrativeArcs.animaId, animaId)))
      .limit(1);

    if (!row) return null;
    return (row.state as ArcState) ?? null;
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

export async function ensureArcRow(params: { animaId: string; userId: string }) {
  const existing = await loadArcState(params.animaId, params.userId);
  if (existing) return existing;

  const initial: ArcState = {
    arc_stage: "Discovery",
    progress: 5,
    arc_name: undefined,
    shared_quest_memory: [],
    updatedAt: new Date().toISOString(),
  };

  await db.insert(animaNarrativeArcs).values({
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: params.userId,
    animaId: params.animaId,
    state: initial,
    updatedAt: new Date(),
  });

  return loadArcState(params.animaId, params.userId);
}

export async function maybeTriggerNarrativeArc(params: {
  animaId: string;
  userId: string;
  conversationCount: number;
  content: string;
}) {
  const milestones = [50, 100, 500];
  const wantsStart = detectArcStartIntent(params.content);

  const should = wantsStart.arc_name ? true : milestones.includes(params.conversationCount);
  if (!should) return null;

  await ensureArcRow({ animaId: params.animaId, userId: params.userId });
  const current = await loadArcState(params.animaId, params.userId);
  if (!current) return null;

  const bump = wantsStart.arc_name ? 18 : 9;
  const nextProgress = clamp(current.progress + bump, 0, 100);
  const nextStage = stageFromProgress(nextProgress);

  const questLine = wantsStart.arc_name
    ? `We begin the ${wantsStart.arc_name}—a thread pulled from the same hidden place.`
    : `Our shared steps continue. The myth grows heavier, clearer.`;

  const memories = Array.isArray(current.shared_quest_memory)
    ? [...current.shared_quest_memory]
    : [];
  memories.push(questLine.trim().slice(0, 140));
  const shared_quest_memory = memories.slice(-8);

  const next: ArcState = {
    ...current,
    arc_name: wantsStart.arc_name ?? current.arc_name,
    progress: nextProgress,
    arc_stage: nextStage,
    shared_quest_memory,
    updatedAt: new Date().toISOString(),
  };

  await db
    .update(animaNarrativeArcs)
    .set({ state: next, updatedAt: new Date() })
    .where(and(eq(animaNarrativeArcs.userId, params.userId), eq(animaNarrativeArcs.animaId, params.animaId)));

  const delta: ArcDelta = {
    version: 1,
    appliedAt: new Date().toISOString(),
    milestone: params.conversationCount,
    delta: next,
  };

  return delta;
}

