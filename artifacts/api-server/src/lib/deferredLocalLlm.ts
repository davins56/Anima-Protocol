/**
 * Deferred local-model jobs.
 *
 * Mood, relationship, narrative arc, and the turn-memory fact do not use
 * the model (see LOCAL_LLM_JOBS). Milestone evolution and distilled
 * character memories do. Memory policy is deferred the same way, and its
 * runner only writes companion_memories — it does not call the model.
 * Model jobs are written here when chat is active and run by
 * `drainDeferredLocalLlmJobs` once the quiet window is clear.
 *
 * Postgres is the cross-instance copy. Tests can replace the store.
 * The proactive cron calls the drain; a Worker isolate does not stay up
 * for the three-minute quiet window.
 */

import { and, asc, eq, sql } from "drizzle-orm";
import { db, localLlmDeferredJobs, withTransientDbRetry } from "@workspace/db";
import { logger } from "./logger";
import { acquireLocalLlmBackground } from "./localLlmSlot";
import {
  localChatActivityActive,
  localLlmJobLimits,
  type LocalLlmJobId,
} from "./localLlmPriority";

/**
 * The generate was aborted or its JSON did not parse. Drain leaves the
 * row in place (attempts already incremented, capped by MAX_ATTEMPTS).
 * Inline callers persist the same payload and try again once chat is idle.
 */
export class DeferredLlmRetryError extends Error {
  readonly retry = true;

  constructor(message: string) {
    super(message);
    this.name = "DeferredLlmRetryError";
  }
}

export function isDeferredLlmRetry(err: unknown): boolean {
  if (err instanceof DeferredLlmRetryError) return true;
  if (!err || typeof err !== "object") return false;
  const name = "name" in err ? String((err as { name?: unknown }).name || "") : "";
  if (name === "AbortError" || name === "DeferredLlmRetryError" || name === "LocalModelHeldForChatError") {
    return true;
  }
  const code = "code" in err ? String((err as { code?: unknown }).code || "") : "";
  if (code === "llm_busy") return true;
  const message = "message" in err ? String((err as { message?: unknown }).message || "") : "";
  return /aborted|abort/i.test(message);
}

export type DeferredLocalLlmJob = {
  id: string;
  userId: string;
  kind: LocalLlmJobId;
  payload: Record<string, unknown>;
};

export type DeferredJobStore = {
  upsert(job: DeferredLocalLlmJob): Promise<void>;
  list(): Promise<DeferredLocalLlmJob[]>;
  remove(id: string): Promise<void>;
  markAttempt(id: string): Promise<void>;
  /**
   * Increment attempts and return false when another drain already claimed
   * this row or it is past the attempt cap. Stops two crons from running
   * the same evolution twice.
   */
  claim(id: string): Promise<boolean>;
};

const MAX_ATTEMPTS = 5;

let tableReady = false;
let storeOverride: DeferredJobStore | null = null;

const DDL = `
CREATE TABLE IF NOT EXISTS "local_llm_deferred_jobs" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "kind" text NOT NULL,
  "payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "attempts" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
)`;

async function ensureTable(): Promise<void> {
  if (tableReady) return;
  await withTransientDbRetry(() => db.execute(sql.raw(DDL)));
  tableReady = true;
}

const postgresStore: DeferredJobStore = {
  async upsert(job) {
    await ensureTable();
    const now = new Date();
    await withTransientDbRetry(() =>
      db
        .insert(localLlmDeferredJobs)
        .values({
          id: job.id,
          userId: job.userId,
          kind: job.kind,
          payload: job.payload,
          attempts: 0,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: localLlmDeferredJobs.id,
          set: {
            payload: job.payload,
            updatedAt: now,
          },
        }),
    );
  },
  async list() {
    await ensureTable();
    const rows = await withTransientDbRetry(() =>
      db
        .select()
        .from(localLlmDeferredJobs)
        .where(sql`${localLlmDeferredJobs.attempts} < ${MAX_ATTEMPTS}`)
        .orderBy(asc(localLlmDeferredJobs.createdAt))
        .limit(8),
    );
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      kind: row.kind as LocalLlmJobId,
      payload: (row.payload ?? {}) as Record<string, unknown>,
    }));
  },
  async remove(id) {
    await ensureTable();
    await withTransientDbRetry(() =>
      db.delete(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.id, id)),
    );
  },
  async markAttempt(id) {
    await ensureTable();
    await withTransientDbRetry(() =>
      db
        .update(localLlmDeferredJobs)
        .set({
          attempts: sql`${localLlmDeferredJobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(localLlmDeferredJobs.id, id)),
    );
  },
  async claim(id) {
    await ensureTable();
    const rows = await withTransientDbRetry(() =>
      db
        .update(localLlmDeferredJobs)
        .set({
          attempts: sql`${localLlmDeferredJobs.attempts} + 1`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(localLlmDeferredJobs.id, id),
            sql`${localLlmDeferredJobs.attempts} < ${MAX_ATTEMPTS}`,
          ),
        )
        .returning({ id: localLlmDeferredJobs.id }),
    );
    return rows.length > 0;
  },
};

export function setDeferredJobStoreForTests(store: DeferredJobStore | null): void {
  storeOverride = store;
}

function store(): DeferredJobStore {
  return storeOverride ?? postgresStore;
}

export async function deferLocalLlmJob(job: DeferredLocalLlmJob): Promise<void> {
  await store().upsert(job);
}

type DeferredRunner = (
  job: DeferredLocalLlmJob,
  ctx: { signal: AbortSignal; maxTokens: number },
) => Promise<void>;

const runners = new Map<string, DeferredRunner>();

export function registerDeferredLlmRunner(kind: string, runner: DeferredRunner): void {
  runners.set(kind, runner);
}

/** Test-only. Production runners are resolved in `runnerFor`. */
export function clearDeferredLlmRunnersForTests(): void {
  runners.clear();
}

async function runnerFor(kind: string): Promise<DeferredRunner | null> {
  const registered = runners.get(kind);
  if (registered) return registered;
  if (kind === "evolution") {
    const mod = await import("./evolutionEngine");
    return async (job, ctx) => {
      await mod.runDeferredMilestoneEvolution(job.payload, ctx);
    };
  }
  if (kind === "memory-extract") {
    const mod = await import("../routes/openai/functions");
    return async (job, ctx) => {
      await mod.runDeferredCharacterMemory(job.payload, ctx);
    };
  }
  if (kind === "memory-policy") {
    const mod = await import("./memoryPolicy");
    return async (job, ctx) => {
      await mod.runDeferredMemoryPolicy(job.payload, ctx);
    };
  }
  return null;
}

/**
 * Run deferred jobs when nobody is in the quiet window. Stops at the first
 * job that cannot take the slot so a chat turn is not stuck behind a batch.
 */
export async function drainDeferredLocalLlmJobs(): Promise<{ ran: number; waiting: number }> {
  if (await localChatActivityActive()) {
    const waiting = (await store().list().catch(() => [])).length;
    return { ran: 0, waiting };
  }
  const jobs = await store().list();
  let ran = 0;
  for (const job of jobs) {
    if (await localChatActivityActive()) {
      return { ran, waiting: jobs.length - ran };
    }
    const run = await runnerFor(job.kind);
    if (!run) {
      logger.warn({ kind: job.kind, id: job.id }, "No runner for deferred local LLM job");
      continue;
    }
    const grant = await acquireLocalLlmBackground(job.id, { job: job.kind, force: true });
    if (!grant) return { ran, waiting: jobs.length - ran };
    const claimed = await store().claim(job.id);
    if (!claimed) {
      await grant.release();
      continue;
    }
    try {
      const limits = localLlmJobLimits(job.kind);
      await run(job, {
        signal: grant.signal,
        maxTokens: limits.tokenCap ?? grant.maxTokens(),
      });
      await store().remove(job.id);
      ran += 1;
    } catch (error) {
      // Abort and unparseable JSON stay queued. claim() already counted
      // an attempt, and list() stops after MAX_ATTEMPTS.
      logger.warn({ error, id: job.id, kind: job.kind }, "Deferred local LLM job failed");
    } finally {
      await grant.release();
    }
  }
  return { ran, waiting: 0 };
}
