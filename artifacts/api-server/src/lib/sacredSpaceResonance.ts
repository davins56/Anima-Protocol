/**
 * Sacred Space → Synchro.
 *
 * A completed Sacred Space activity earns a small, bounded, one-time amount of
 * long-term resonance (Synchro strength, 0–100) for the authenticated user and
 * one character. The award lives on `companion_memories.emotional_state` next
 * to the Synchro fields it changes and touches nothing else there (mood,
 * affect, vector dimensions). It never reads or writes Heat, which is a
 * separate short-term intimacy meter, and it writes no memories.
 *
 * Idempotency: each award is keyed by the client session id inside
 * `emotional_state.sacredSpace.awards`. A retry returns the original result.
 * Concurrency: callers hold the per-companion advisory lock (see
 * `awardSacredSpaceResonance`) so chat turns and ritual completion serialize.
 */
import { and, eq, sql } from "drizzle-orm";
import { companionMemories, db, withTransientDbRetry } from "@workspace/db";
import {
  SYNCHRO_LEVEL_LABELS,
  computeSynchroLevel,
  initSynchroState,
  type SynchroLevel,
} from "./synchroEngine";

export const SACRED_STATE_KEY = "sacredSpace";

export type SacredActivity = "sacred_space_session" | "meditation_ritual";

export const SACRED_ACTIVITIES: readonly SacredActivity[] = [
  "sacred_space_session",
  "meditation_ritual",
];

export interface SacredRewardConfig {
  /** Points for a completed guided Sacred Space session. */
  sessionReward: number;
  /** Points for a completed meditation ritual. */
  ritualReward: number;
  /** Extra point when the user wrote a reflection. */
  reflectionBonus: number;
  /** Most points one character can earn from Sacred Space per UTC day. */
  dailyCap: number;
  /** Fewest user messages that count a Sacred Space session as completed. */
  minSessionTurns: number;
  /** Fewest ritual steps that count a ritual as completed. */
  minRitualSteps: number;
}

export const DEFAULT_SACRED_REWARD_CONFIG: SacredRewardConfig = {
  sessionReward: 2,
  ritualReward: 2,
  reflectionBonus: 1,
  dailyCap: 5,
  minSessionTurns: 2,
  minRitualSteps: 3,
};

/** Hard ceilings: configuration can tune rewards but never make them large. */
const CONFIG_BOUNDS: Record<keyof SacredRewardConfig, [number, number]> = {
  sessionReward: [0, 5],
  ritualReward: [0, 5],
  reflectionBonus: [0, 3],
  dailyCap: [0, 10],
  minSessionTurns: [1, 20],
  minRitualSteps: [1, 6],
};

const ENV_KEYS: Record<keyof SacredRewardConfig, string> = {
  sessionReward: "ANIMA_SACRED_SESSION_REWARD",
  ritualReward: "ANIMA_SACRED_RITUAL_REWARD",
  reflectionBonus: "ANIMA_SACRED_REFLECTION_BONUS",
  dailyCap: "ANIMA_SACRED_DAILY_CAP",
  minSessionTurns: "ANIMA_SACRED_MIN_SESSION_TURNS",
  minRitualSteps: "ANIMA_SACRED_MIN_RITUAL_STEPS",
};

export function loadSacredRewardConfig(
  env: Record<string, string | undefined> = process.env,
): SacredRewardConfig {
  const out = { ...DEFAULT_SACRED_REWARD_CONFIG };
  for (const key of Object.keys(out) as (keyof SacredRewardConfig)[]) {
    const raw = env[ENV_KEYS[key]];
    if (raw === undefined || raw.trim() === "") continue;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) continue;
    const [lo, hi] = CONFIG_BOUNDS[key];
    out[key] = Math.max(lo, Math.min(hi, Math.round(parsed)));
  }
  return out;
}

export interface SacredCompletion {
  activity: SacredActivity;
  /** User messages sent during a Sacred Space session. */
  userTurns?: number;
  /** Ritual steps finished. */
  stepsCompleted?: number;
  hasReflection?: boolean;
}

/** Points earned before the daily cap. Zero when the activity was not really completed. */
export function computeSacredReward(
  config: SacredRewardConfig,
  completion: SacredCompletion,
): number {
  let base = 0;
  if (completion.activity === "sacred_space_session") {
    if ((completion.userTurns ?? 0) < config.minSessionTurns) return 0;
    base = config.sessionReward;
  } else if (completion.activity === "meditation_ritual") {
    if ((completion.stepsCompleted ?? 0) < config.minRitualSteps) return 0;
    base = config.ritualReward;
  } else {
    return 0;
  }
  if (base <= 0) return 0;
  return base + (completion.hasReflection ? config.reflectionBonus : 0);
}

interface AwardRecord {
  amount: number;
  activity: SacredActivity;
  at: string;
}

interface SacredLedger {
  awards: Record<string, AwardRecord>;
  daily: { date: string; total: number };
  totalAwarded: number;
}

/** Remembered session ids per companion; older ones can no longer be replayed for points. */
const MAX_REMEMBERED_AWARDS = 60;

const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{7,99}$/;

export function isValidSacredSessionId(value: unknown): value is string {
  return typeof value === "string" && SESSION_ID_PATTERN.test(value);
}

function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function readLedger(emotionalState: Record<string, unknown>): SacredLedger {
  const raw = emotionalState[SACRED_STATE_KEY];
  const obj = raw && typeof raw === "object" && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : {};
  const awardsRaw =
    obj.awards && typeof obj.awards === "object" && !Array.isArray(obj.awards)
      ? (obj.awards as Record<string, unknown>)
      : {};
  const awards: Record<string, AwardRecord> = {};
  for (const [id, value] of Object.entries(awardsRaw)) {
    const rec = value as Partial<AwardRecord> | null;
    if (rec && typeof rec.amount === "number" && typeof rec.at === "string") {
      awards[id] = {
        amount: rec.amount,
        activity: rec.activity === "meditation_ritual" ? "meditation_ritual" : "sacred_space_session",
        at: rec.at,
      };
    }
  }
  const daily = obj.daily as { date?: unknown; total?: unknown } | undefined;
  return {
    awards,
    daily: {
      date: typeof daily?.date === "string" ? daily.date : "",
      total: typeof daily?.total === "number" ? daily.total : 0,
    },
    totalAwarded: typeof obj.totalAwarded === "number" ? obj.totalAwarded : 0,
  };
}

export interface SacredAwardResult {
  /** Points added now (0 on a duplicate, a cap hit, or an incomplete activity). */
  awarded: number;
  duplicate: boolean;
  capped: boolean;
  strength: number;
  level: SynchroLevel;
  previousLevel: SynchroLevel;
  tierChanged: boolean;
}

/**
 * Pure: apply one award to an emotional-state blob.
 * Only `synchroStrength`, `synchroLevel`, `lastInteraction`, and the
 * `sacredSpace` ledger change; every other key is carried through untouched.
 */
export function applySacredAward(
  emotionalState: Record<string, unknown> | null | undefined,
  input: { sessionId: string; completion: SacredCompletion; now?: Date },
  config: SacredRewardConfig = loadSacredRewardConfig(),
): { state: Record<string, unknown>; result: SacredAwardResult; changed: boolean } {
  const now = input.now ?? new Date();
  const base =
    emotionalState && typeof emotionalState === "object" ? { ...emotionalState } : {};
  const ledger = readLedger(base);
  // Idle decay is applied first, exactly as a chat turn would, so a long
  // absence is not erased by completing a ritual.
  const current = initSynchroState(base, null, null);
  const startStrength = current.vector.synchroStrength;
  const previousLevel = current.level;

  const existing = ledger.awards[input.sessionId];
  if (existing) {
    return {
      state: base,
      changed: false,
      result: {
        awarded: 0,
        duplicate: true,
        capped: false,
        strength: startStrength,
        level: previousLevel,
        previousLevel,
        tierChanged: false,
      },
    };
  }

  const today = utcDay(now);
  const dailyTotal = ledger.daily.date === today ? ledger.daily.total : 0;
  const earned = computeSacredReward(config, input.completion);
  const room = Math.max(0, config.dailyCap - dailyTotal);
  const amount = Math.min(earned, room, 100 - startStrength);
  const capped = earned > 0 && amount < earned;

  const strength = Math.max(0, Math.min(100, startStrength + amount));
  const level = computeSynchroLevel(strength);

  const awards = {
    ...ledger.awards,
    [input.sessionId]: {
      amount,
      activity: input.completion.activity,
      at: now.toISOString(),
    },
  };
  const ids = Object.keys(awards);
  if (ids.length > MAX_REMEMBERED_AWARDS) {
    ids
      .sort((a, b) => Date.parse(awards[a]!.at) - Date.parse(awards[b]!.at))
      .slice(0, ids.length - MAX_REMEMBERED_AWARDS)
      .forEach((id) => delete awards[id]);
  }

  const state: Record<string, unknown> = {
    ...base,
    synchroStrength: strength,
    synchroLevel: level,
    lastInteraction: now.toISOString(),
    [SACRED_STATE_KEY]: {
      awards,
      daily: { date: today, total: dailyTotal + amount },
      totalAwarded: ledger.totalAwarded + amount,
    },
  };

  return {
    state,
    changed: true,
    result: {
      awarded: amount,
      duplicate: false,
      capped,
      strength,
      level,
      previousLevel,
      tierChanged: level !== previousLevel,
    },
  };
}

export class SacredCharacterNotFoundError extends Error {
  constructor() {
    super("Character not found");
    this.name = "SacredCharacterNotFoundError";
  }
}

/**
 * Persist one award. Scoped by (userId, characterId); takes the same
 * per-companion advisory lock as other `companion_memories` writers, and the
 * chat turn's relationship write, so neither can overwrite the other.
 * The upsert sets `emotional_state` only: facts, summary and notes are not read
 * back or rewritten.
 */
export async function awardSacredSpaceResonance(input: {
  userId: string;
  characterId: string;
  sessionId: string;
  completion: SacredCompletion;
  now?: Date;
  config?: SacredRewardConfig;
}): Promise<SacredAwardResult & { label: string }> {
  const { userId, characterId } = input;
  const out = await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${characterId}`}))`,
      );
      const [row] = await tx
        .select({ emotionalState: companionMemories.emotionalState })
        .from(companionMemories)
        .where(
          and(
            eq(companionMemories.userId, userId),
            eq(companionMemories.characterId, characterId),
          ),
        )
        .limit(1);
      const applied = applySacredAward(
        (row?.emotionalState as Record<string, unknown> | undefined) ?? {},
        { sessionId: input.sessionId, completion: input.completion, now: input.now },
        input.config,
      );
      if (applied.changed) {
        const at = input.now ?? new Date();
        await tx
          .insert(companionMemories)
          .values({ userId, characterId, emotionalState: applied.state, updatedAt: at })
          .onConflictDoUpdate({
            target: [companionMemories.userId, companionMemories.characterId],
            set: { emotionalState: applied.state, updatedAt: at },
          });
      }
      return applied.result;
    }),
  );
  return { ...out, label: SYNCHRO_LEVEL_LABELS[out.level] };
}

/** Current Synchro for one companion, with the same idle decay a chat turn would see. */
export async function readSynchroSummary(
  userId: string,
  characterId: string,
): Promise<{ strength: number; level: SynchroLevel; label: string }> {
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ emotionalState: companionMemories.emotionalState })
      .from(companionMemories)
      .where(
        and(
          eq(companionMemories.userId, userId),
          eq(companionMemories.characterId, characterId),
        ),
      )
      .limit(1),
  );
  const state = initSynchroState(
    (row?.emotionalState as Record<string, unknown> | undefined) ?? null,
    null,
    null,
  );
  return {
    strength: state.vector.synchroStrength,
    level: state.level,
    label: SYNCHRO_LEVEL_LABELS[state.level],
  };
}
