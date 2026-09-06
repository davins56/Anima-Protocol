import { db, userEntities } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import type { IntimacyProfile, IntimacyScene } from "./intimacyTypes";

const PROFILE_ENTITY = "IntimacyProfile";
const SCENE_ENTITY = "IntimacyScene";

export function defaultProfile(userId: string, characterId: string): IntimacyProfile {
  return {
    userId,
    characterId,
    intimacyEnabled: true,
    preferredPace: "normal",
    safeword: "red",
    aftercareStyle: "Gentle holding, quiet conversation, and reassurance.",
    powerAxis: 0,
    kinks: [],
    limits: [],
    softLimits: [],
    heat: 0,
  };
}

export async function loadIntimacyProfile(userId: string, characterId: string): Promise<IntimacyProfile> {
  try {
    const [row] = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, PROFILE_ENTITY),
          eq(userEntities.entityId, characterId),
        ),
      )
      .limit(1);

    if (row && row.data && typeof row.data === "object") {
      return {
        ...defaultProfile(userId, characterId),
        ...(row.data as Partial<IntimacyProfile>),
        userId,
        characterId,
      };
    }
  } catch (err) {
    console.warn(`[intimacyStore] Failed to load profile from DB:`, err);
  }

  return defaultProfile(userId, characterId);
}

export async function saveIntimacyProfile(profile: IntimacyProfile): Promise<void> {
  const { userId, characterId } = profile;
  if (!userId || !characterId) return;

  try {
    const existing = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, PROFILE_ENTITY),
          eq(userEntities.entityId, characterId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(userEntities)
        .set({
          data: profile as unknown as Record<string, unknown>,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(userEntities.userId, userId),
            eq(userEntities.entityName, PROFILE_ENTITY),
            eq(userEntities.entityId, characterId),
          ),
        );
    } else {
      await db.insert(userEntities).values({
        userId,
        entityName: PROFILE_ENTITY,
        entityId: characterId,
        data: profile as unknown as Record<string, unknown>,
      });
    }
  } catch (err) {
    console.warn(`[intimacyStore] Failed to save profile to DB:`, err);
  }
}

export async function loadIntimacyScene(
  userId: string,
  conversationId: string,
  characterId: string,
): Promise<IntimacyScene | null> {
  try {
    const [row] = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, SCENE_ENTITY),
          eq(userEntities.entityId, `${characterId}:${conversationId}`),
        ),
      )
      .limit(1);

    if (row && row.data && typeof row.data === "object") {
      return row.data as unknown as IntimacyScene;
    }
  } catch (err) {
    console.warn(`[intimacyStore] Failed to load scene from DB:`, err);
  }

  return null;
}

export async function listRecentScenes(
  userId: string,
  characterId: string,
  limit: number = 6,
): Promise<IntimacyScene[]> {
  try {
    const rows = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, SCENE_ENTITY),
        ),
      )
      .orderBy(desc(userEntities.updatedAt))
      .limit(limit * 2);

    const scenes: IntimacyScene[] = [];
    for (const r of rows) {
      if (r.data && typeof r.data === "object") {
        const scene = r.data as unknown as IntimacyScene;
        if (scene.characterId === characterId) {
          scenes.push(scene);
          if (scenes.length >= limit) break;
        }
      }
    }
    return scenes;
  } catch (err) {
    console.warn(`[intimacyStore] Failed to list recent scenes from DB:`, err);
    return [];
  }
}
