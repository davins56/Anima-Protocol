/**
 * Postgres storage for Model Tutor. Lessons and advice belong to the model,
 * not to one account, so they live in a reserved `user_entities` partition
 * (`__anima_model__`). The generic /api/store always scopes to the caller's
 * Clerk id, so no client can read or write this partition — only the
 * steward-gated /api/tutor routes and /api/model do.
 *
 * Per-user switches (the steward's "Answer my chats with my model", and
 * anyone's consent to learn from their own-model chats) sit in the profile
 * under `model_tutor`, outside `settings`, so a Settings save never
 * overwrites them. /api/chat/messages already loads the profile, so the
 * switches cost the chat hot path nothing.
 */

import { and, desc, eq, sql } from "drizzle-orm";
import { db, userEntities, userProfiles, withTransientDbRetry } from "@workspace/db";
import { randomUUID } from "node:crypto";
import {
  MAX_ADVICE_CHARS,
  MAX_ADVICE_ITEMS,
  TutorInputError,
  type ModelAdvice,
  type ModelLesson,
} from "./modelTutor";
import { MODEL_PARTITION, modelTutorPrefs, type ModelTutorPrefs } from "./ownModel";

export const MODEL_TUTOR_PARTITION = MODEL_PARTITION;
export const MODEL_LESSON_ENTITY = "ModelLesson";
export const MODEL_ADVICE_ENTITY = "ModelAdvice";
export const MAX_STORED_LESSONS = 5000;

function scope(entityName: string) {
  return and(
    eq(userEntities.userId, MODEL_TUTOR_PARTITION),
    eq(userEntities.entityName, entityName),
  );
}

async function upsert(entityName: string, entityId: string, data: object): Promise<void> {
  await withTransientDbRetry(() =>
    db
      .insert(userEntities)
      .values({ userId: MODEL_TUTOR_PARTITION, entityName, entityId, data })
      .onConflictDoUpdate({
        target: [userEntities.userId, userEntities.entityName, userEntities.entityId],
        set: { data, updatedAt: new Date() },
      }),
  );
}

// ------------------------------------------------------------------ lessons

export async function listLessons(limit = 200): Promise<ModelLesson[]> {
  const rows = await withTransientDbRetry(() =>
    db
      .select({ data: userEntities.data })
      .from(userEntities)
      .where(scope(MODEL_LESSON_ENTITY))
      .orderBy(desc(userEntities.createdAt), desc(userEntities.id))
      .limit(Math.min(Math.max(limit, 1), MAX_STORED_LESSONS)),
  );
  return rows.map((row) => row.data as ModelLesson);
}

export async function countLessons(): Promise<number> {
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(userEntities)
      .where(scope(MODEL_LESSON_ENTITY)),
  );
  return Number(row?.count ?? 0);
}

export interface LessonCounts {
  total: number;
  pending: number;
  learned: number;
  failed: number;
  auto: number;
  auto_pending: number;
}

export async function lessonCounts(): Promise<LessonCounts> {
  const status = sql`${userEntities.data}->>'status'`;
  const auto = sql`${userEntities.data}->>'source' = 'auto'`;
  const [row] = await withTransientDbRetry(() =>
    db
      .select({
        total: sql<number>`count(*)::int`,
        pending: sql<number>`count(*) filter (where ${status} = 'saved')::int`,
        learned: sql<number>`count(*) filter (where ${status} = 'learned')::int`,
        failed: sql<number>`count(*) filter (where ${status} = 'failed')::int`,
        auto: sql<number>`count(*) filter (where ${auto})::int`,
        auto_pending: sql<number>`count(*) filter (where ${auto} and ${status} = 'saved')::int`,
      })
      .from(userEntities)
      .where(scope(MODEL_LESSON_ENTITY)),
  );
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    learned: Number(row?.learned ?? 0),
    failed: Number(row?.failed ?? 0),
    auto: Number(row?.auto ?? 0),
    auto_pending: Number(row?.auto_pending ?? 0),
  };
}

export async function getLesson(id: string): Promise<ModelLesson | null> {
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ data: userEntities.data })
      .from(userEntities)
      .where(and(scope(MODEL_LESSON_ENTITY), eq(userEntities.entityId, id)))
      .limit(1),
  );
  return row ? (row.data as ModelLesson) : null;
}

export async function saveLesson(lesson: ModelLesson): Promise<ModelLesson> {
  await upsert(MODEL_LESSON_ENTITY, lesson.id, lesson);
  return lesson;
}

export async function deleteLesson(id: string): Promise<boolean> {
  const deleted = await withTransientDbRetry(() =>
    db
      .delete(userEntities)
      .where(and(scope(MODEL_LESSON_ENTITY), eq(userEntities.entityId, id)))
      .returning({ id: userEntities.id }),
  );
  return deleted.length > 0;
}

// ------------------------------------------------------------------ advice

export async function listAdvice(): Promise<ModelAdvice[]> {
  const rows = await withTransientDbRetry(() =>
    db
      .select({ data: userEntities.data })
      .from(userEntities)
      .where(scope(MODEL_ADVICE_ENTITY))
      .orderBy(userEntities.createdAt, userEntities.id)
      .limit(MAX_ADVICE_ITEMS),
  );
  return rows.map((row) => row.data as ModelAdvice);
}

export async function addAdvice(rawText: unknown, taughtBy: string): Promise<ModelAdvice> {
  const text = typeof rawText === "string" ? rawText.trim() : "";
  if (!text) throw new TutorInputError("Write the advice first.");
  if (text.length > MAX_ADVICE_CHARS) {
    throw new TutorInputError(`Keep advice under ${MAX_ADVICE_CHARS} characters.`);
  }
  if ((await listAdvice()).length >= MAX_ADVICE_ITEMS) {
    throw new TutorInputError(`You can keep up to ${MAX_ADVICE_ITEMS} pieces of advice.`);
  }
  const advice: ModelAdvice = {
    id: `adv_${randomUUID().replace(/-/g, "").slice(0, 24)}`,
    text,
    taught_by: taughtBy,
    created_date: new Date().toISOString(),
  };
  await upsert(MODEL_ADVICE_ENTITY, advice.id, advice);
  return advice;
}

export async function deleteAdvice(id: string): Promise<boolean> {
  const deleted = await withTransientDbRetry(() =>
    db
      .delete(userEntities)
      .where(and(scope(MODEL_ADVICE_ENTITY), eq(userEntities.entityId, id)))
      .returning({ id: userEntities.id }),
  );
  return deleted.length > 0;
}

// ------------------------------------------------------------------ preferences

export async function readModelTutorPrefs(userId: string): Promise<ModelTutorPrefs> {
  const [row] = await withTransientDbRetry(() =>
    db
      .select({ data: userProfiles.data })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId))
      .limit(1),
  );
  return modelTutorPrefs(row?.data);
}

/** Merge into the profile's `model_tutor` without touching anything else. */
export async function writeModelTutorPrefs(
  userId: string,
  patch: Partial<ModelTutorPrefs>,
): Promise<void> {
  const json = JSON.stringify(patch);
  await withTransientDbRetry(() =>
    db
      .insert(userProfiles)
      .values({ userId, data: { model_tutor: patch } })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: {
          data: sql`coalesce(${userProfiles.data}, '{}'::jsonb) || jsonb_build_object('model_tutor', coalesce(${userProfiles.data} -> 'model_tutor', '{}'::jsonb) || ${json}::jsonb)`,
          updatedAt: new Date(),
        },
      }),
  );
}
