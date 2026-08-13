import webpush, { type PushSubscription as WebPushSubscription } from "web-push";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  asObject,
  chatMessages,
  chatSessions,
  companionMemories,
  db,
  getPool,
  makeId,
  migrateSessionMessages,
  proactiveMessagePreferences,
  pushSubscriptions,
  sessionIdEq,
  userEntities,
  type MsgData,
} from "@workspace/db";
import { createChatCompletionWithFailover } from "./llmFailover";
import { routeModel } from "./modelRouter";
import { buildCompanionPrompt, type CharacterData } from "./promptBuilder";
import { notifyUser } from "./storeEvents";

export const PROACTIVE_FREQUENCIES = [24, 72, 168] as const;
export type ProactiveFrequency = (typeof PROACTIVE_FREQUENCIES)[number];

const DEFAULT_BATCH_SIZE = 2;
const DEFAULT_MIN_INACTIVE_HOURS = 8;
const MAX_MESSAGE_LENGTH = 320;

type ClaimedPreference = {
  userId: string;
  frequencyHours: number;
  lastSessionId: string | null;
};

type Candidate = {
  sessionId: string;
  character: CharacterData;
  recentMessages: MsgData[];
};

export type ProactiveRunResult =
  | {
      status: "sent";
      userId: string;
      sessionId: string;
      characterName: string;
      delivered: number;
    }
  | {
      status: "skipped" | "failed";
      userId: string;
      reason: string;
    };

export function normalizeProactiveFrequency(value: unknown): ProactiveFrequency {
  const parsed = Number(value);
  return PROACTIVE_FREQUENCIES.includes(parsed as ProactiveFrequency)
    ? (parsed as ProactiveFrequency)
    : 24;
}

function boundedInteger(raw: string | undefined, fallback: number, max: number): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(max, Math.trunc(parsed)));
}

function truncate(value: unknown, max = 800): string {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function sanitizeProactiveMessage(value: unknown): string {
  let text = String(value ?? "")
    .trim()
    .replace(/^```(?:text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .replace(/^["“]|["”]$/g, "")
    .trim();
  if (text.length > MAX_MESSAGE_LENGTH) {
    const shortened = text.slice(0, MAX_MESSAGE_LENGTH + 1);
    const sentenceEnd = Math.max(
      shortened.lastIndexOf("."),
      shortened.lastIndexOf("!"),
      shortened.lastIndexOf("?"),
    );
    text =
      sentenceEnd >= 80
        ? shortened.slice(0, sentenceEnd + 1)
        : `${text.slice(0, MAX_MESSAGE_LENGTH - 1).trimEnd()}…`;
  }
  return text;
}

export function vapidPublicKey(): string | null {
  return process.env.VAPID_PUBLIC_KEY?.trim() || null;
}

function configureWebPush(): boolean {
  const publicKey = vapidPublicKey();
  const privateKey = process.env.VAPID_PRIVATE_KEY?.trim();
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT?.trim() || "mailto:support@anima-protocol.com",
    publicKey,
    privateKey,
  );
  return true;
}

export function proactivePushConfigured(): boolean {
  return Boolean(vapidPublicKey() && process.env.VAPID_PRIVATE_KEY?.trim());
}

async function claimDuePreferences(limit: number): Promise<ClaimedPreference[]> {
  const { rows } = await getPool().query<{
    user_id: string;
    frequency_hours: number;
    last_session_id: string | null;
  }>(
    `WITH due AS (
       SELECT p.user_id
       FROM proactive_message_preferences p
       WHERE p.enabled = true
         AND p.next_message_at IS NOT NULL
         AND p.next_message_at <= now()
         AND EXISTS (
           SELECT 1 FROM push_subscriptions s WHERE s.user_id = p.user_id
         )
       ORDER BY p.next_message_at ASC
       LIMIT $1
       FOR UPDATE SKIP LOCKED
     )
     UPDATE proactive_message_preferences p
     SET next_message_at = now() + make_interval(hours => p.frequency_hours),
         updated_at = now()
     FROM due
     WHERE p.user_id = due.user_id
     RETURNING p.user_id, p.frequency_hours, p.last_session_id`,
    [limit],
  );
  return rows.map((row) => ({
    userId: row.user_id,
    frequencyHours: row.frequency_hours,
    lastSessionId: row.last_session_id,
  }));
}

async function deferPreference(userId: string, hours: number): Promise<void> {
  await db
    .update(proactiveMessagePreferences)
    .set({
      nextMessageAt: new Date(Date.now() + hours * 60 * 60 * 1000),
      updatedAt: new Date(),
    })
    .where(eq(proactiveMessagePreferences.userId, userId));
}

async function completePreference(userId: string, sessionId: string): Promise<void> {
  await db
    .update(proactiveMessagePreferences)
    .set({
      lastSentAt: new Date(),
      lastSessionId: sessionId,
      updatedAt: new Date(),
    })
    .where(eq(proactiveMessagePreferences.userId, userId));
}

function isProactiveMessage(message: {
  metadata?: unknown;
  role?: string | null;
}): boolean {
  const metadata =
    message.metadata && typeof message.metadata === "object"
      ? (message.metadata as Record<string, unknown>)
      : {};
  return message.role === "assistant" && metadata.source === "proactive_push";
}

async function loadCandidate(
  userId: string,
  lastSessionId: string | null,
): Promise<Candidate | null> {
  const sessions = await db
    .select()
    .from(chatSessions)
    .where(
      and(
        eq(chatSessions.userId, userId),
        eq(chatSessions.mode, "solo"),
        sql`jsonb_array_length(${chatSessions.characterIds}) > 0`,
      ),
    )
    .orderBy(desc(chatSessions.updatedAt))
    .limit(12);

  const ordered = lastSessionId
    ? [
        ...sessions.filter((session) => session.id !== lastSessionId),
        ...sessions.filter((session) => session.id === lastSessionId),
      ]
    : sessions;
  const inactiveBefore = new Date(
    Date.now() -
      boundedInteger(
        process.env.PROACTIVE_MESSAGE_MIN_INACTIVE_HOURS,
        DEFAULT_MIN_INACTIVE_HOURS,
        168,
      ) *
        60 *
        60 *
        1000,
  );

  for (const session of ordered) {
    const newestFirst = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, session.id),
        ),
      )
      .orderBy(desc(chatMessages.createdAt))
      .limit(24);
    if (newestFirst.length === 0) continue;
    if (!newestFirst.some((message) => message.role === "user")) continue;
    if (newestFirst[0]!.createdAt > inactiveBefore) continue;
    // Never stack check-ins when the user has not answered the previous one.
    if (isProactiveMessage(newestFirst[0]!)) continue;

    const characterId = String(session.characterIds[0] || "");
    if (!characterId) continue;
    const [characterRow] = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          inArray(userEntities.entityName, ["Character", "Anima"]),
          eq(userEntities.entityId, characterId),
        ),
      )
      .limit(1);
    if (!characterRow) continue;
    const characterData = asObject(characterRow.data);
    const name = String(characterData.name || "").trim();
    if (!name) continue;

    return {
      sessionId: session.id,
      character: {
        ...characterData,
        id: String(characterData.id || characterId),
        name,
        ...(characterRow.entityName === "Anima"
          ? { _isAnima: true, universe: characterData.universe || "Anima" }
          : {}),
      } as CharacterData,
      recentMessages: newestFirst
        .reverse()
        .map((message) => ({
          role: message.role,
          content: message.content,
          character_name: message.characterName || undefined,
          timestamp: message.createdAt.toISOString(),
        })),
    };
  }
  return null;
}

async function generateMessage(userId: string, candidate: Candidate): Promise<string> {
  const [memory] = await db
    .select()
    .from(companionMemories)
    .where(
      and(
        eq(companionMemories.userId, userId),
        eq(companionMemories.characterId, String(candidate.character.id)),
      ),
    )
    .limit(1);
  const memories = memory
    ? [
        {
          characterId: memory.characterId,
          summary: memory.summary,
          facts: memory.facts,
          emotionalState: memory.emotionalState,
          resonanceNotes: memory.resonanceNotes,
          updatedAt: memory.updatedAt,
        },
      ]
    : [];
  const instruction =
    "Send one warm, natural check-in as this character after some time apart. " +
    "Continue the relationship or conversation without claiming the user said something new. " +
    "Do not mention apps, notifications, inactivity, schedules, or being an AI. " +
    "Do not guilt, pressure, alarm, sexualize, or manipulate the user. " +
    "Keep it safe for a lock-screen preview, in character, and at most two short sentences.";
  const prompt = buildCompanionPrompt({
    systemPrompt: instruction,
    characters: [candidate.character],
    activeCharacter: candidate.character,
    memories,
    recentMessages: candidate.recentMessages,
    mode: "solo",
    content: "[Proactive outreach: send the check-in now.]",
    isCrossover: false,
  });
  const routed = routeModel("brief proactive companion check-in", {
    deepMode: false,
    conversationDepth: candidate.recentMessages.length,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25_000);
  timer.unref?.();
  try {
    const completion = await createChatCompletionWithFailover({
      tier: "light",
      model: routed.model,
      maxTokens: 120,
      temperature: 0.8,
      messages: [{ role: "system", content: prompt }],
      signal: controller.signal,
    });
    return sanitizeProactiveMessage(completion.content);
  } finally {
    clearTimeout(timer);
  }
}

async function appendStoreMessage(
  userId: string,
  sessionId: string,
  message: MsgData,
): Promise<MsgData> {
  return db.transaction(async (tx) => {
    await migrateSessionMessages(tx, userId, sessionId);
    const [agg] = await tx
      .select({
        maxSeq: sql<string>`coalesce(max((${userEntities.data} ->> 'seq')::numeric), -1)`,
      })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
          sessionIdEq(sessionId),
        ),
      );
    const seq = Number(agg?.maxSeq ?? -1) + 1;
    const now = new Date().toISOString();
    const id = String(message.id || makeId());
    const data = {
      ...message,
      id,
      session_id: sessionId,
      seq,
      created_date: message.created_date ?? message.timestamp ?? now,
      updated_date: now,
    };
    await tx.insert(userEntities).values({
      userId,
      entityName: CHAT_MESSAGE,
      entityId: id,
      data,
    });
    return data;
  });
}

async function persistMessage(
  userId: string,
  candidate: Candidate,
  content: string,
): Promise<void> {
  const now = new Date();
  const message = {
    role: "assistant",
    content,
    character_id: candidate.character.id,
    character_name: candidate.character.name,
    timestamp: now.toISOString(),
    proactive: true,
    metadata: { source: "proactive_push" },
  };
  await appendStoreMessage(userId, candidate.sessionId, message);
  await Promise.all([
    db.insert(chatMessages).values({
      id: makeId(),
      sessionId: candidate.sessionId,
      userId,
      role: "assistant",
      content,
      characterId: String(candidate.character.id),
      characterName: candidate.character.name,
      isCrossover: false,
      metadata: { source: "proactive_push" },
      createdAt: now,
    }),
    db
      .update(chatSessions)
      .set({ updatedAt: now })
      .where(
        and(
          eq(chatSessions.userId, userId),
          eq(chatSessions.id, candidate.sessionId),
        ),
      ),
  ]);

  const [sessionRow] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_SESSION),
        eq(userEntities.entityId, candidate.sessionId),
      ),
    )
    .limit(1);
  if (sessionRow) {
    const sessionData = asObject(sessionRow.data);
    await db
      .update(userEntities)
      .set({
        data: {
          ...sessionData,
          last_message: truncate(content, 80),
          updated_date: now.toISOString(),
        },
        updatedAt: now,
      })
      .where(eq(userEntities.id, sessionRow.id));
  }
  notifyUser(userId);
}

async function deliverPush(
  userId: string,
  candidate: Candidate,
  content: string,
): Promise<number> {
  if (!configureWebPush()) return 0;
  const subscriptions = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  const payload = JSON.stringify({
    title: `${candidate.character.name} sent you a message`,
    body: content,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: `anima-session-${candidate.sessionId}`,
    data: { url: `/chat/${encodeURIComponent(candidate.sessionId)}` },
  });
  let delivered = 0;
  const expiredIds: number[] = [];
  await Promise.all(
    subscriptions.map(async (subscription) => {
      const target: WebPushSubscription = {
        endpoint: subscription.endpoint,
        keys: {
          p256dh: subscription.p256dh,
          auth: subscription.auth,
        },
      };
      try {
        await webpush.sendNotification(target, payload, { TTL: 60 * 60 * 12 });
        delivered += 1;
      } catch (err) {
        const statusCode =
          err && typeof err === "object" && "statusCode" in err
            ? Number((err as { statusCode?: unknown }).statusCode)
            : 0;
        if (statusCode === 404 || statusCode === 410) {
          expiredIds.push(subscription.id);
        }
      }
    }),
  );
  if (expiredIds.length > 0) {
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, expiredIds));
  }
  return delivered;
}

async function runClaim(claim: ClaimedPreference): Promise<ProactiveRunResult> {
  try {
    const candidate = await loadCandidate(claim.userId, claim.lastSessionId);
    if (!candidate) {
      await deferPreference(claim.userId, 12);
      return {
        status: "skipped",
        userId: claim.userId,
        reason: "No eligible inactive chat",
      };
    }
    const content = await generateMessage(claim.userId, candidate);
    if (!content) {
      throw new Error("The model returned an empty proactive message");
    }
    await persistMessage(claim.userId, candidate, content);
    const delivered = await deliverPush(claim.userId, candidate, content);
    await completePreference(claim.userId, candidate.sessionId);
    return {
      status: "sent",
      userId: claim.userId,
      sessionId: candidate.sessionId,
      characterName: String(candidate.character.name),
      delivered,
    };
  } catch (err) {
    await deferPreference(claim.userId, 1).catch(() => {});
    return {
      status: "failed",
      userId: claim.userId,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function runProactiveMessageBatch(): Promise<ProactiveRunResult[]> {
  if (!proactivePushConfigured()) {
    throw new Error("VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required");
  }
  const limit = boundedInteger(
    process.env.PROACTIVE_MESSAGE_BATCH_SIZE,
    DEFAULT_BATCH_SIZE,
    10,
  );
  const claims = await claimDuePreferences(limit);
  return Promise.all(claims.map(runClaim));
}
