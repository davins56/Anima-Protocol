/**
 * The own model: the from-scratch tiny GPT (training/, server/) living
 * inside the app. Nothing has to be kept running for it:
 *
 * - Weights sit in Postgres (`own_model_blobs`, 512 KiB chunks per version).
 *   Browsers download the current version once, cache it, and generate
 *   replies on the device (artifacts/anima-protocol/src/lib/ownModel/).
 * - Lessons (the steward's corrections, and automatic ones drafted by the
 *   main Anima model) queue in the `__anima_model__` partition.
 * - server/trainer.py learns the queue on a GitHub Actions schedule and
 *   publishes the next version; browsers pick it up on their next chat.
 *
 * The state record below is shared with server/trainer.py — keep the field
 * names in step.
 */

import { and, eq, ne, sql } from "drizzle-orm";
import { db, ownModelBlobs, userEntities, withTransientDbRetry } from "@workspace/db";
import { logger } from "./logger";
import { callerIsProtocolSteward } from "./protocolUpgradeAuth";

export const MODEL_PARTITION = "__anima_model__";
export const MODEL_STATE_ENTITY = "ModelState";
export const MODEL_STATE_ID = "state";
export const BLOB_CHUNK_BYTES = 512 * 1024;
export const MAX_MODEL_BYTES = 256 * 1024 * 1024;
export const OWN_MODEL_ID = "anima-own";
export const DEFAULT_TRAINER_REPO = "davins56/Anima-Protocol";
export const TRAINER_WORKFLOW = "own-model-trainer.yml";

/** Shown in place of an empty reply so the turn can still be taught. */
export const OWN_MODEL_EMPTY_REPLY = "…";

export type BlobKind = "inference" | "master";
export const BLOB_KINDS: readonly BlobKind[] = ["inference", "master"];

// Must match ownModelBlobs in lib/db/src/schema/index.ts and server/trainer.py.
const BLOBS_DDL = `CREATE TABLE IF NOT EXISTS "own_model_blobs" (
  "version" integer NOT NULL,
  "kind" text NOT NULL,
  "idx" integer NOT NULL,
  "data" bytea NOT NULL,
  "created_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "own_model_blobs_pk" PRIMARY KEY ("version", "kind", "idx")
)`;

export class OwnModelError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "own_model_error") {
    super(message);
    this.name = "OwnModelError";
    this.status = status;
    this.code = code;
  }
}

// ------------------------------------------------------------------ state

export interface BlobInfo {
  bytes: number;
  chunks: number;
  sha256?: string;
}

export interface ModelVersionEntry {
  kind: "base" | "learned" | "rebuild";
  created_at: string;
  lessons: number;
  inference: BlobInfo;
  master: BlobInfo;
  /** Model shape, recorded by the upload (the trainer's versions inherit it). */
  config?: Record<string, number>;
}

export interface TrainerHeartbeat {
  status: string;
  at: string;
  version?: number;
  learned?: number;
  failed?: number;
  duration_s?: number;
  message?: string;
}

export interface ModelState {
  base_version: number | null;
  current_version: number | null;
  versions: Record<string, ModelVersionEntry>;
  /** Everyone's chats (not just the steward's) are answered by the own model. */
  answer_everyone: boolean;
  /** Own-model turns queue automatic lessons drafted by the main model. */
  always_learning: boolean;
  /** Automatic lessons may come from users who opted in, not only the steward. */
  learn_from_opted_in: boolean;
  /** Bumped when a learned lesson is deleted: relearn everything from the base. */
  rebuild_seq: number;
  rebuilt_seq: number;
  trainer: TrainerHeartbeat | null;
  trainer_checked_at: string | null;
  trainer_dispatched_at: string | null;
  uploads: Record<string, PendingUpload>;
}

export interface PendingUpload {
  started_at: string;
  config: Record<string, number>;
  inference: BlobInfo;
  master: BlobInfo;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function nonNegativeInt(value: unknown): number {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

export function normalizeModelState(raw: unknown): ModelState {
  const data = asRecord(raw);
  const trainer = asRecord(data.trainer);
  return {
    base_version: positiveInt(data.base_version),
    current_version: positiveInt(data.current_version),
    versions: asRecord(data.versions) as Record<string, ModelVersionEntry>,
    answer_everyone: data.answer_everyone === true,
    always_learning: data.always_learning === true,
    learn_from_opted_in: data.learn_from_opted_in === true,
    rebuild_seq: nonNegativeInt(data.rebuild_seq),
    rebuilt_seq: nonNegativeInt(data.rebuilt_seq),
    trainer: typeof trainer.status === "string" ? (trainer as unknown as TrainerHeartbeat) : null,
    trainer_checked_at: stringOrNull(data.trainer_checked_at),
    trainer_dispatched_at: stringOrNull(data.trainer_dispatched_at),
    uploads: asRecord(data.uploads) as Record<string, PendingUpload>,
  };
}

/** The version browsers should run, with its blob layout — or null. */
export function currentVersion(
  state: ModelState,
): { version: number; entry: ModelVersionEntry } | null {
  const version = state.current_version;
  if (!version) return null;
  const entry = state.versions[String(version)];
  if (!entry?.inference?.chunks) return null;
  return { version, entry };
}

function stateScope() {
  return and(
    eq(userEntities.userId, MODEL_PARTITION),
    eq(userEntities.entityName, MODEL_STATE_ENTITY),
    eq(userEntities.entityId, MODEL_STATE_ID),
  );
}

export async function readModelState(): Promise<ModelState> {
  const [row] = await withTransientDbRetry(() =>
    db.select({ data: userEntities.data }).from(userEntities).where(stateScope()).limit(1),
  );
  return normalizeModelState(row?.data);
}

/** Shallow-merge top-level fields (Postgres `||`), creating the record if needed. */
export async function mergeModelState(patch: Partial<ModelState>): Promise<void> {
  await withTransientDbRetry(() =>
    db
      .insert(userEntities)
      .values({
        userId: MODEL_PARTITION,
        entityName: MODEL_STATE_ENTITY,
        entityId: MODEL_STATE_ID,
        data: patch,
      })
      .onConflictDoUpdate({
        target: [userEntities.userId, userEntities.entityName, userEntities.entityId],
        set: { data: sql`${userEntities.data} || excluded.data`, updatedAt: new Date() },
      }),
  );
}

/** A learned lesson was removed: the trainer relearns the rest from the base. */
export async function requestRelearn(): Promise<void> {
  await withTransientDbRetry(() =>
    db
      .insert(userEntities)
      .values({
        userId: MODEL_PARTITION,
        entityName: MODEL_STATE_ENTITY,
        entityId: MODEL_STATE_ID,
        data: { rebuild_seq: 1 },
      })
      .onConflictDoUpdate({
        target: [userEntities.userId, userEntities.entityName, userEntities.entityId],
        set: {
          data: sql`${userEntities.data} || jsonb_build_object('rebuild_seq', coalesce((${userEntities.data}->>'rebuild_seq')::int, 0) + 1)`,
          updatedAt: new Date(),
        },
      }),
  );
}

// ------------------------------------------------------------------ weights

let blobsTableReady = false;

/** `own_model_blobs` is created on first use, so no deploy step is needed. */
export async function ensureOwnModelBlobsTable(): Promise<void> {
  if (blobsTableReady) return;
  await withTransientDbRetry(() => db.execute(sql.raw(BLOBS_DDL)));
  blobsTableReady = true;
}

function isMissingTable(err: unknown): boolean {
  const code = (err as { code?: unknown; cause?: { code?: unknown } } | null) ?? {};
  return code.code === "42P01" || code.cause?.code === "42P01";
}

/**
 * Chunks travel as base64 text, converted by Postgres. postgres.js (the
 * Worker's driver) moves bytea as hex and decodes it in JavaScript — about
 * 1 MB of string work per chunk, too much for a Worker's CPU budget. This
 * way the Worker only passes strings through and browsers decode natively.
 */
export async function readBlobChunk(
  version: number,
  kind: BlobKind,
  idx: number,
): Promise<string | null> {
  try {
    const [row] = await withTransientDbRetry(() =>
      db
        .select({
          base64: sql<string>`replace(encode(${ownModelBlobs.data}, 'base64'), chr(10), '')`,
        })
        .from(ownModelBlobs)
        .where(
          and(
            eq(ownModelBlobs.version, version),
            eq(ownModelBlobs.kind, kind),
            eq(ownModelBlobs.idx, idx),
          ),
        )
        .limit(1),
    );
    return row ? row.base64 : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/** Bytes a base64 string decodes to, or null when it isn't clean base64. */
export function base64ByteLength(text: string): number | null {
  if (text.length % 4 !== 0 || !BASE64_RE.test(text)) return null;
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

export async function writeBlobChunk(
  version: number,
  kind: BlobKind,
  idx: number,
  base64: string,
): Promise<void> {
  await ensureOwnModelBlobsTable();
  await withTransientDbRetry(() =>
    db
      .insert(ownModelBlobs)
      .values({ version, kind, idx, data: sql`decode(${base64}, 'base64')` })
      .onConflictDoUpdate({
        target: [ownModelBlobs.version, ownModelBlobs.kind, ownModelBlobs.idx],
        set: { data: sql`excluded.data`, createdAt: new Date() },
      }),
  );
}

/** Chunks stored for one blob, and their total size. */
export async function blobStats(
  version: number,
  kind: BlobKind,
): Promise<{ chunks: number; bytes: number }> {
  await ensureOwnModelBlobsTable();
  const [row] = await withTransientDbRetry(() =>
    db
      .select({
        chunks: sql<number>`count(*)::int`,
        bytes: sql<number>`coalesce(sum(octet_length(${ownModelBlobs.data})), 0)::bigint`,
      })
      .from(ownModelBlobs)
      .where(and(eq(ownModelBlobs.version, version), eq(ownModelBlobs.kind, kind))),
  );
  return { chunks: Number(row?.chunks ?? 0), bytes: Number(row?.bytes ?? 0) };
}

/** Never reuse a number: browsers cache chunks by version forever. */
export async function nextModelVersion(state: ModelState): Promise<number> {
  await ensureOwnModelBlobsTable();
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ top: sql<number>`coalesce(max(${ownModelBlobs.version}), 0)::int` })
      .from(ownModelBlobs),
  );
  const known = [
    ...Object.keys(state.versions).map(Number),
    ...Object.keys(state.uploads).map(Number),
    state.current_version ?? 0,
    Number(row?.top ?? 0),
  ].filter(Number.isFinite);
  return Math.max(0, ...known) + 1;
}

/**
 * Make a fully uploaded model the new base: serve it, queue every learned
 * lesson to be learned again on top of it, and drop older weights. Same as
 * server/trainer.py's install_base.
 */
export async function installBaseVersion(version: number, entry: ModelVersionEntry): Promise<void> {
  await withTransientDbRetry(() =>
    db.transaction(async (tx) => {
      await tx
        .update(userEntities)
        .set({
          data: sql`(${userEntities.data} - 'uploads') || jsonb_build_object(
            'base_version', ${version}::int,
            'current_version', ${version}::int,
            'versions', jsonb_build_object(${String(version)}::text, ${JSON.stringify(entry)}::jsonb),
            'uploads', '{}'::jsonb,
            'rebuilt_seq', coalesce((${userEntities.data}->>'rebuild_seq')::int, 0))`,
          updatedAt: new Date(),
        })
        .where(stateScope());
      await tx
        .update(userEntities)
        .set({
          data: sql`${userEntities.data} || '{"status": "saved", "attempts": 0}'::jsonb`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userEntities.userId, MODEL_PARTITION),
            eq(userEntities.entityName, "ModelLesson"),
            sql`${userEntities.data}->>'status' = 'learned'`,
          ),
        );
      await tx.delete(ownModelBlobs).where(ne(ownModelBlobs.version, version));
    }),
  );
}

/** Forget a half-finished upload and its chunks. */
export async function discardUpload(version: number): Promise<void> {
  await ensureOwnModelBlobsTable();
  await withTransientDbRetry(() =>
    db.delete(ownModelBlobs).where(eq(ownModelBlobs.version, version)),
  );
  await withTransientDbRetry(() =>
    db
      .update(userEntities)
      .set({
        data: sql`jsonb_set(${userEntities.data}, '{uploads}', coalesce(${userEntities.data}->'uploads', '{}'::jsonb) - ${String(version)}::text)`,
        updatedAt: new Date(),
      })
      .where(stateScope()),
  );
}

// ------------------------------------------------------------------ access

export interface ModelTutorPrefs {
  /** Steward only: answer my chats with my model. */
  own_model_chat: boolean;
  /** Anyone: my chats with the own model may become lessons. */
  share_for_training: boolean;
}

/** Per-user switches, kept in the profile under `model_tutor`. */
export function modelTutorPrefs(profile: unknown): ModelTutorPrefs {
  const prefs = asRecord(asRecord(profile).model_tutor);
  return {
    own_model_chat: prefs.own_model_chat === true,
    share_for_training: prefs.share_for_training === true,
  };
}

const STEWARD_CACHE_MS = 10 * 60_000;
const stewardCache = new Map<string, { allowed: boolean; at: number }>();

/** Steward check for hot paths: a Clerk lookup at most every 10 min per user. */
export async function callerIsStewardCached(input: {
  userId: string;
  sessionClaims?: unknown;
}): Promise<boolean> {
  const hit = stewardCache.get(input.userId);
  if (hit && Date.now() - hit.at < STEWARD_CACHE_MS) return hit.allowed;
  const { allowed } = await callerIsProtocolSteward(input);
  stewardCache.set(input.userId, { allowed, at: Date.now() });
  return allowed;
}

export function resetOwnModelForTests(): void {
  stewardCache.clear();
  blobsTableReady = false;
  lastDispatchAt = 0;
}

export interface OwnModelAccess {
  /** A model is published and this user's chats are answered by it. */
  enabled: boolean;
  /** Their own-model turns may become automatic lessons. */
  learning: boolean;
}

/**
 * Who chats with the own model, and whose chats it learns from. The profile
 * is writable by its owner through the generic store, so `own_model_chat`
 * only counts for the steward; `share_for_training` is the user's own
 * consent and counts only while the steward allows learning from others.
 * The steward lookup (Clerk, cached) only runs when the answer depends on it.
 */
export async function ownModelAccess(input: {
  userId: string;
  sessionClaims?: unknown;
  profile: unknown;
  state: ModelState;
}): Promise<OwnModelAccess> {
  const { state } = input;
  if (!currentVersion(state)) return { enabled: false, learning: false };
  const prefs = modelTutorPrefs(input.profile);
  let steward: boolean | null = null;
  const isSteward = async () => (steward ??= await callerIsStewardCached(input));
  const enabled = state.answer_everyone || (prefs.own_model_chat && (await isSteward()));
  if (!enabled || !state.always_learning) return { enabled, learning: false };
  const learning = (state.learn_from_opted_in && prefs.share_for_training) || (await isSteward());
  return { enabled, learning };
}

// ------------------------------------------------------------------ trainer

let lastDispatchAt = 0;
const DISPATCH_DEBOUNCE_MS = 60_000;

export function trainerDispatchConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.GITHUB_TRAINER_TOKEN?.trim());
}

/**
 * Start the trainer now rather than at its next scheduled run. Optional:
 * without GITHUB_TRAINER_TOKEN the 15-minute schedule picks lessons up.
 * Never throws — a lesson is saved whether or not this works.
 */
export async function dispatchTrainer(env: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const token = env.GITHUB_TRAINER_TOKEN?.trim();
  if (!token) return false;
  if (Date.now() - lastDispatchAt < DISPATCH_DEBOUNCE_MS) return false;
  lastDispatchAt = Date.now();
  const repo = env.GITHUB_TRAINER_REPO?.trim() || DEFAULT_TRAINER_REPO;
  const ref = env.GITHUB_TRAINER_REF?.trim() || "main";
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/actions/workflows/${TRAINER_WORKFLOW}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "anima-protocol-api",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref }),
        signal: AbortSignal.timeout(8_000),
      },
    );
    if (res.status !== 204) {
      logger.warn({ status: res.status }, "Own-model trainer dispatch was refused");
      return false;
    }
    await mergeModelState({ trainer_dispatched_at: new Date().toISOString() }).catch(() => {});
    return true;
  } catch (err) {
    logger.warn({ err }, "Own-model trainer dispatch failed");
    return false;
  }
}
