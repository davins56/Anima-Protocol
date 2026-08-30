import { createClerkClient, type ClerkClient } from "@clerk/backend";
import {
  db,
  userEntities,
  userProfiles,
  companionMemories,
  chatSessions,
  chatMessages,
  conversations,
} from "@workspace/db";
import { and, eq, inArray, or, sql } from "drizzle-orm";

export type MigrateUserDataOptions = {
  fromEmail: string;
  toEmail: string;
  /** When set, only copy these entity_name values from user_entities. */
  entityNames?: string[];
  dryRun?: boolean;
  clerkSecretKey?: string;
  /** Skip Clerk lookup and use these user ids directly. */
  fromUserId?: string;
  toUserId?: string;
};

export type MigrateUserDataResult = {
  fromEmail: string;
  toEmail: string;
  fromUserId: string;
  toUserId: string;
  entitiesCopied: number;
  entitiesSkipped: number;
  companionMemoriesUpdated: number;
  chatSessionsUpdated: number;
  chatMessagesUpdated: number;
  conversationsUpdated: number;
  emailFieldsPatched: number;
  dryRun: boolean;
};

const EMAIL_JSON_PATHS = [
  ["assigned_user"],
  ["user_email"],
  ["email"],
] as const;

function clerkClient(secretKey: string): ClerkClient {
  return createClerkClient({ secretKey });
}

export async function resolveClerkUserIdByEmail(
  secretKey: string,
  email: string,
): Promise<string | null> {
  const clerk = clerkClient(secretKey);
  const normalized = email.trim().toLowerCase();
  const users = await clerk.users.getUserList({
    emailAddress: [normalized],
    limit: 5,
  });
  if (users.data[0]?.id) {
    return users.data[0].id;
  }

  const byQuery = await clerk.users.getUserList({ query: normalized, limit: 20 });
  for (const user of byQuery.data) {
    const emails = user.emailAddresses.map((entry) =>
      entry.emailAddress.toLowerCase(),
    );
    if (emails.includes(normalized)) {
      return user.id;
    }
    for (const account of user.externalAccounts ?? []) {
      const externalEmail = account.emailAddress?.toLowerCase();
      if (externalEmail === normalized) {
        return user.id;
      }
    }
  }
  return null;
}

/** Fallback when Clerk has no user for an email (legacy/local accounts). */
export async function findUserIdByEmailInDb(
  email: string,
): Promise<string | null> {
  const normalized = email.trim().toLowerCase();
  const [fromAnima] = await db
    .select({ userId: userEntities.userId })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.entityName, "Anima"),
        sql`lower(${userEntities.data}->>'assigned_user') = ${normalized}`,
      ),
    )
    .limit(1);
  if (fromAnima?.userId) {
    return fromAnima.userId;
  }

  const jsonMatch = or(
    sql`lower(${userEntities.data}->>'user_email') = ${normalized}`,
    sql`lower(${userEntities.data}->>'email') = ${normalized}`,
  );
  const [fromEntity] = await db
    .select({ userId: userEntities.userId })
    .from(userEntities)
    .where(jsonMatch)
    .limit(1);
  if (fromEntity?.userId) {
    return fromEntity.userId;
  }

  const [fromProfile] = await db
    .select({ userId: userProfiles.userId })
    .from(userProfiles)
    .where(
      or(
        sql`lower(${userProfiles.data}->>'email') = ${normalized}`,
        sql`lower(${userProfiles.data}->>'email_address') = ${normalized}`,
      ),
    )
    .limit(1);
  return fromProfile?.userId ?? null;
}

function patchEmailFields(
  data: Record<string, unknown>,
  fromEmail: string,
  toEmail: string,
): { data: Record<string, unknown>; patched: number } {
  let patched = 0;
  const next = { ...data };
  const from = fromEmail.trim().toLowerCase();
  for (const path of EMAIL_JSON_PATHS) {
    const key = path[0];
    const value = next[key];
    if (typeof value === "string" && value.trim().toLowerCase() === from) {
      next[key] = toEmail;
      patched += 1;
    }
  }
  return { data: next, patched };
}

export async function migrateUserData(
  options: MigrateUserDataOptions,
): Promise<MigrateUserDataResult> {
  const fromEmail = options.fromEmail.trim().toLowerCase();
  const toEmail = options.toEmail.trim().toLowerCase();
  const dryRun = Boolean(options.dryRun);
  const secretKey = options.clerkSecretKey ?? process.env.CLERK_SECRET_KEY ?? "";

  let fromUserId = options.fromUserId ?? null;
  let toUserId = options.toUserId ?? null;

  if (!fromUserId && secretKey) {
    fromUserId = await resolveClerkUserIdByEmail(secretKey, fromEmail);
  }
  if (!toUserId && secretKey) {
    toUserId = await resolveClerkUserIdByEmail(secretKey, toEmail);
  }
  if (!fromUserId) {
    fromUserId = await findUserIdByEmailInDb(fromEmail);
  }
  if (!toUserId) {
    toUserId = await findUserIdByEmailInDb(toEmail);
  }

  if (!fromUserId) {
    throw new Error(
      `Could not resolve source account for ${fromEmail}. Check Clerk or database JSON email fields.`,
    );
  }
  if (!toUserId) {
    throw new Error(
      `Could not resolve target account for ${toEmail}. The user must sign in at least once.`,
    );
  }
  if (fromUserId === toUserId) {
    throw new Error("Source and target resolve to the same Clerk user id.");
  }

  const entityFilter = options.entityNames?.length
    ? options.entityNames
    : null;

  const sourceRows = await db
    .select()
    .from(userEntities)
    .where(
      entityFilter
        ? and(
            eq(userEntities.userId, fromUserId),
            inArray(userEntities.entityName, entityFilter),
          )
        : eq(userEntities.userId, fromUserId),
    );

  let entitiesCopied = 0;
  let entitiesSkipped = 0;
  let emailFieldsPatched = 0;

  if (!dryRun) {
    await db.transaction(async (tx) => {
      const sourceMemoryCharacterIds = (
        await tx
          .select({ characterId: companionMemories.characterId })
          .from(companionMemories)
          .where(eq(companionMemories.userId, fromUserId))
      ).map((row) => row.characterId);

      if (sourceMemoryCharacterIds.length > 0) {
        await tx
          .delete(companionMemories)
          .where(
            and(
              eq(companionMemories.userId, toUserId!),
              inArray(companionMemories.characterId, sourceMemoryCharacterIds),
            ),
          );
      }

      for (const row of sourceRows) {
        const raw = row.data as Record<string, unknown>;
        const { data, patched } = patchEmailFields(raw, fromEmail, toEmail);
        emailFieldsPatched += patched;
        await tx
          .insert(userEntities)
          .values({
            userId: toUserId!,
            entityName: row.entityName,
            entityId: row.entityId,
            data,
          })
          .onConflictDoUpdate({
            target: [
              userEntities.userId,
              userEntities.entityName,
              userEntities.entityId,
            ],
            set: { data, updatedAt: new Date() },
          });
        entitiesCopied += 1;
      }

      await tx
        .update(companionMemories)
        .set({ userId: toUserId!, updatedAt: new Date() })
        .where(eq(companionMemories.userId, fromUserId));
      await tx
        .update(chatSessions)
        .set({ userId: toUserId!, updatedAt: new Date() })
        .where(eq(chatSessions.userId, fromUserId));
      await tx
        .update(chatMessages)
        .set({ userId: toUserId! })
        .where(eq(chatMessages.userId, fromUserId));
      await tx
        .update(conversations)
        .set({ userId: toUserId!, updatedAt: new Date() })
        .where(eq(conversations.userId, fromUserId));
    });
  } else {
    entitiesCopied = sourceRows.length;
  }

  const companionMemoriesUpdated = dryRun
    ? (
        await db
          .select({ id: companionMemories.id })
          .from(companionMemories)
          .where(eq(companionMemories.userId, fromUserId))
      ).length
    : (
        await db
          .select({ id: companionMemories.id })
          .from(companionMemories)
          .where(eq(companionMemories.userId, toUserId))
      ).length;

  const chatSessionsUpdated = dryRun
    ? (
        await db
          .select({ id: chatSessions.id })
          .from(chatSessions)
          .where(eq(chatSessions.userId, fromUserId))
      ).length
    : (
        await db
          .select({ id: chatSessions.id })
          .from(chatSessions)
          .where(eq(chatSessions.userId, toUserId))
      ).length;

  const chatMessagesUpdated = dryRun
    ? (
        await db
          .select({ id: chatMessages.id })
          .from(chatMessages)
          .where(eq(chatMessages.userId, fromUserId))
      ).length
    : (
        await db
          .select({ id: chatMessages.id })
          .from(chatMessages)
          .where(eq(chatMessages.userId, toUserId))
      ).length;

  const conversationsUpdated = dryRun
    ? (
        await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.userId, fromUserId))
      ).length
    : (
        await db
          .select({ id: conversations.id })
          .from(conversations)
          .where(eq(conversations.userId, toUserId))
      ).length;

  if (!dryRun) {
    const targetEntities = await db
      .select()
      .from(userEntities)
      .where(eq(userEntities.userId, toUserId));
    for (const row of targetEntities) {
      const raw = row.data as Record<string, unknown>;
      const { data, patched } = patchEmailFields(raw, fromEmail, toEmail);
      if (patched > 0) {
        await db
          .update(userEntities)
          .set({ data, updatedAt: new Date() })
          .where(eq(userEntities.id, row.id));
        emailFieldsPatched += patched;
      }
    }
  }

  return {
    fromEmail,
    toEmail,
    fromUserId,
    toUserId,
    entitiesCopied,
    entitiesSkipped,
    companionMemoriesUpdated,
    chatSessionsUpdated,
    chatMessagesUpdated,
    conversationsUpdated,
    emailFieldsPatched,
    dryRun,
  };
}
