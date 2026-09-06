import { and, desc, eq } from "drizzle-orm";
import { db, userEntities, withTransientDbRetry, asObject, makeId } from "@workspace/db";
import type { IntimacyProfile, IntimacyScene } from "./intimacyTypes";

export function defaultProfile(userId: string, characterId: string): IntimacyProfile {
  return {
    userId,
    characterId,
    heat: 0,
    bondErotic: 0,
    powerAxis: 0,
    preferredPace: "slow",
    anatomy: {},
    kinks: [],
    limits: [],
    softLimits: [],
    safeword: "red",
    aftercareStyle: "quiet grounding, closeness, verbal check-in",
    sceneCount: 0,
    intimacyEnabled: false,
    updatedAt: new Date().toISOString(),
  };
}

export function defaultScene(userId: string, conversationId: string, characterId: string): IntimacyScene {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    conversationId,
    characterId,
    userId,
    phase: "closed",
    clothingState: {},
    focusMap: {},
    actsLog: [],
    heatPeak: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function loadIntimacyProfile(userId: string, characterId: string): Promise<IntimacyProfile> {
  try {
    const entityId = `${userId}:${characterId}`;
    const [row] = await withTransientDbRetry(() =>
      db
        .select()
        .from(userEntities)
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, "IntimacyProfile"),
            eq(userEntities.entityId, entityId),
          ),
        )
        .limit(1),
    );

    if (!row) return defaultProfile(userId, characterId);
    const data = asObject(row.data) as unknown as Partial<IntimacyProfile>;
    return {
      ...defaultProfile(userId, characterId),
      ...data,
      userId,
      characterId,
    };
  } catch (err) {
    console.error("loadIntimacyProfile error:", err);
    return defaultProfile(userId, characterId);
  }
}

export async function saveIntimacyProfile(profile: IntimacyProfile): Promise<void> {
  try {
    const entityId = `${profile.userId}:${profile.characterId}`;
    const now = new Date();
    const dataToSave = {
      ...profile,
      updatedAt: now.toISOString(),
    };

    await withTransientDbRetry(() =>
      db
        .insert(userEntities)
        .values({
          userId: profile.userId,
          entityName: "IntimacyProfile",
          entityId,
          data: dataToSave as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userEntities.userId, userEntities.entityName, userEntities.entityId],
          set: {
            data: dataToSave as unknown as Record<string, unknown>,
            updatedAt: now,
          },
        }),
    );
  } catch (err) {
    console.error("saveIntimacyProfile error:", err);
  }
}

export async function loadIntimacyScene(
  userId: string,
  conversationId: string,
  characterId: string,
): Promise<IntimacyScene> {
  try {
    const entityId = `${userId}:${conversationId}:${characterId}`;
    const [row] = await withTransientDbRetry(() =>
      db
        .select()
        .from(userEntities)
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, "IntimacyScene"),
            eq(userEntities.entityId, entityId),
          ),
        )
        .limit(1),
    );

    if (!row) return defaultScene(userId, conversationId, characterId);
    const data = asObject(row.data) as unknown as Partial<IntimacyScene>;
    return {
      ...defaultScene(userId, conversationId, characterId),
      ...data,
      userId,
      conversationId,
      characterId,
    };
  } catch (err) {
    console.error("loadIntimacyScene error:", err);
    return defaultScene(userId, conversationId, characterId);
  }
}

export async function saveIntimacyScene(scene: IntimacyScene): Promise<void> {
  try {
    const entityId = `${scene.userId}:${scene.conversationId}:${scene.characterId}`;
    const now = new Date();
    const dataToSave = {
      ...scene,
      updatedAt: now.toISOString(),
    };

    await withTransientDbRetry(() =>
      db
        .insert(userEntities)
        .values({
          userId: scene.userId,
          entityName: "IntimacyScene",
          entityId,
          data: dataToSave as unknown as Record<string, unknown>,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: [userEntities.userId, userEntities.entityName, userEntities.entityId],
          set: {
            data: dataToSave as unknown as Record<string, unknown>,
            updatedAt: now,
          },
        }),
    );
  } catch (err) {
    console.error("saveIntimacyScene error:", err);
  }
}

export async function listRecentScenes(
  userId: string,
  characterId: string,
  limit = 10,
): Promise<IntimacyScene[]> {
  try {
    const rows = await withTransientDbRetry(() =>
      db
        .select()
        .from(userEntities)
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, "IntimacyScene"),
          ),
        )
        .orderBy(desc(userEntities.updatedAt))
        .limit(limit * 2),
    );

    const scenes: IntimacyScene[] = [];
    for (const row of rows) {
      const data = asObject(row.data) as unknown as IntimacyScene;
      if (data && data.characterId === characterId) {
        scenes.push(data);
        if (scenes.length >= limit) break;
      }
    }
    return scenes;
  } catch (err) {
    console.error("listRecentScenes error:", err);
    return [];
  }
}
