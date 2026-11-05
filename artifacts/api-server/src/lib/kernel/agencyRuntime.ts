/**
 * Agency Engine tick, runtime half (switch `agency`). Gathers the percept for
 * one proactive candidate from systems that already exist, runs the pure
 * decision in ./agencyTick.ts, and records the outcome on the Anima's
 * self-state. No new tables. See ANIMA_KERNEL.md §5 and §11.
 */
import { chatMessages, companionMemories, db, getPool, userProfiles, type MsgData } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { dueThread, extractOpenThreads } from "../agencyThreads";
import { initCompanionAffect, SELF_STATE_KEY } from "../companionAffect";
import { readConversationalWeather } from "../hiddenSequences";
import { isKernelFeatureEnabled } from "../kernelFeatures";
import { logger } from "../logger";
import { regionHintsFromProfile } from "../regionalWorldKnowledge";
import {
  agencyConfig,
  decideAgencyTick,
  localHourIn,
  selfStatePatchForDecision,
  type AgencyDecision,
  type AgencyPercept,
} from "./agencyTick";
import { readStoredSenses, SENSES_PROFILE_KEY, sensesPercept } from "./senses";

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function gapHours(recent: MsgData[], now: number): number {
  const last = recent[recent.length - 1]?.timestamp;
  const t = last ? Date.parse(String(last)) : NaN;
  return Number.isFinite(t) ? Math.max(0, (now - t) / 3_600_000) : 0;
}

/** The steward's newest message anywhere, so an unanswered outreach in one thread blocks the others. */
async function latestMessageAnywhere(userId: string): Promise<{ role: string | null; proactive: boolean } | null> {
  const [row] = await db
    .select({ role: chatMessages.role, metadata: chatMessages.metadata })
    .from(chatMessages)
    .where(eq(chatMessages.userId, userId))
    .orderBy(desc(chatMessages.createdAt))
    .limit(1);
  if (!row) return null;
  return { role: row.role ?? null, proactive: asRecord(row.metadata).source === "proactive_push" };
}

export async function perceiveForCandidate(args: {
  userId: string;
  characterId: string;
  recentMessages: MsgData[];
  frequencyHours: number;
  now?: number;
}): Promise<AgencyPercept> {
  const now = args.now ?? Date.now();
  const [memoryRow] = await db
    .select({ emotionalState: companionMemories.emotionalState })
    .from(companionMemories)
    .where(and(eq(companionMemories.userId, args.userId), eq(companionMemories.characterId, args.characterId)))
    .limit(1);
  const [profileRow] = await db
    .select({ data: userProfiles.data })
    .from(userProfiles)
    .where(eq(userProfiles.userId, args.userId))
    .limit(1);
  const latest = await latestMessageAnywhere(args.userId).catch(() => null);

  const affect = initCompanionAffect(asRecord(memoryRow?.emotionalState), new Date(now).toISOString());
  const profile = asRecord(profileRow?.data);
  const senses = isKernelFeatureEnabled("senses") ? readStoredSenses(profile[SENSES_PROFILE_KEY], now) : null;
  const timezone = regionHintsFromProfile(profile)?.timezone || senses?.timezone || null;
  const last = args.recentMessages[args.recentMessages.length - 1];
  const lastRole = latest?.role ?? (last?.role === "user" || last?.role === "assistant" ? String(last.role) : null);

  return {
    now,
    gapHours: gapHours(args.recentMessages, now),
    lastRole: lastRole === "user" || lastRole === "assistant" ? lastRole : null,
    lastWasProactive: latest?.proactive ?? false,
    localHour: localHourIn(timezone, now),
    weather: readConversationalWeather(args.recentMessages as Array<{ content?: string }>),
    threadDue: dueThread(extractOpenThreads(args.recentMessages), now) != null,
    affect: {
      primary: affect.primary,
      intensity: affect.intensity,
      energy: affect.energy,
      openLoops: affect.openLoops.length,
      lastActedAt: affect.lastActedAt,
    },
    senses: sensesPercept(senses, now),
    frequencyHours: Math.max(1, args.frequencyHours),
  };
}

/**
 * Merge the tick outcome into emotional_state.selfState in one statement, so a
 * concurrent chat write to other emotional_state keys is not clobbered.
 * No companion_memories row yet → nothing to record.
 */
export async function recordAgencyOutcome(
  userId: string,
  characterId: string,
  decision: AgencyDecision,
  now = Date.now(),
): Promise<void> {
  const patch = selfStatePatchForDecision(decision, new Date(now).toISOString());
  await getPool().query(
    `UPDATE companion_memories
       SET emotional_state = jsonb_set(
             COALESCE(emotional_state, '{}'::jsonb),
             '{${SELF_STATE_KEY}}',
             COALESCE(emotional_state -> '${SELF_STATE_KEY}', '{}'::jsonb) || $3::jsonb,
             true)
     WHERE user_id = $1 AND character_id = $2`,
    [userId, characterId, JSON.stringify(patch)],
  );
}

/** Perceive, decide, log. Never throws: on failure the caller keeps today's behaviour. */
export async function runAgencyTick(args: {
  userId: string;
  characterId: string;
  recentMessages: MsgData[];
  frequencyHours: number;
}): Promise<AgencyDecision | null> {
  try {
    const percept = await perceiveForCandidate(args);
    const decision = decideAgencyTick(percept, agencyConfig());
    logger.info(
      {
        act: decision.act,
        situation: decision.situation,
        score: decision.score,
        silenceReason: decision.act ? null : decision.silenceReason,
      },
      "agency: tick",
    );
    return decision;
  } catch (err) {
    logger.warn({ err: (err as Error)?.message }, "agency: tick failed, falling back to the proactive clock");
    return null;
  }
}
