import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  complete: vi.fn(async () => ({
    content: "I was thinking about our last adventure. How are you holding up?",
    provider: "local",
    brand: "anima",
    model: "test-model",
    tier: "light",
    failedOver: false,
  })),
  sendNotification: vi.fn(async () => ({})),
  setVapidDetails: vi.fn(),
}));

vi.mock("../src/lib/llmFailover", () => ({
  createChatCompletionWithFailover: mocks.complete,
}));

vi.mock("../src/lib/animaJournal", () => ({
  generateAutonomousReflection: vi.fn(async () => null),
}));

vi.mock("../src/lib/homeWorld", () => ({
  addSharedArtifact: vi.fn(async () => null),
}));

vi.mock("web-push", () => ({
  default: {
    sendNotification: mocks.sendNotification,
    setVapidDetails: mocks.setVapidDetails,
  },
}));

import { runProactiveMessageBatch } from "../src/lib/proactiveMessages";
import {
  chatMessages,
  chatSessions,
  db,
  ensureSchemaOnce,
  proactiveMessagePreferences,
  pushSubscriptions,
  userEntities,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

const prefix = `proactive_batch_${Date.now()}_${Math.random().toString(36).slice(2)}_`;
const userId = `${prefix}user`;
const sessionId = `${prefix}session`;
const characterId = `${prefix}character`;

beforeAll(async () => {
  process.env.VAPID_PUBLIC_KEY = "test-public-key";
  process.env.VAPID_PRIVATE_KEY = "test-private-key";
  process.env.PROACTIVE_MESSAGE_BATCH_SIZE = "2";
  process.env.PROACTIVE_MESSAGE_MIN_INACTIVE_HOURS = "1";
  await ensureSchemaOnce();
  const old = new Date(Date.now() - 10 * 60 * 60 * 1000);
  await db.insert(userEntities).values([
    {
      userId,
      entityName: "Character",
      entityId: characterId,
      data: {
        id: characterId,
        name: "Aria",
        personality: "warm, observant, and concise",
      },
    },
    {
      userId,
      entityName: "ChatSession",
      entityId: sessionId,
      data: {
        id: sessionId,
        title: "Aria",
        mode: "solo",
        character_id: characterId,
        messages: [],
        messages_migrated: true,
      },
    },
  ]);
  await db.insert(chatSessions).values({
    id: sessionId,
    userId,
    title: "Aria",
    mode: "solo",
    characterIds: [characterId],
    isCrossover: false,
    updatedAt: old,
  });
  await db.insert(chatMessages).values([
    {
      id: `${prefix}user-message`,
      sessionId,
      userId,
      role: "user",
      content: "That was quite an adventure.",
      isCrossover: false,
      createdAt: old,
    },
    {
      id: `${prefix}assistant-message`,
      sessionId,
      userId,
      role: "assistant",
      content: "We made it through together.",
      characterId,
      characterName: "Aria",
      isCrossover: false,
      createdAt: new Date(old.getTime() + 1000),
    },
  ]);
  await db.insert(pushSubscriptions).values({
    userId,
    endpoint: `https://push.example.test/${userId}`,
    p256dh: "p256dh-test-key",
    auth: "auth-test-key",
  });
  await db.insert(proactiveMessagePreferences).values({
    userId,
    enabled: true,
    frequencyHours: 24,
    nextMessageAt: new Date(Date.now() - 1000),
  });
});

afterAll(async () => {
  await db
    .delete(proactiveMessagePreferences)
    .where(eq(proactiveMessagePreferences.userId, userId));
  await db
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
  await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
  await db.delete(userEntities).where(eq(userEntities.userId, userId));
});

describe("proactive message batch", () => {
  it("generates, stores, and pushes a due character check-in", async () => {
    const results = await runProactiveMessageBatch();

    expect(results).toEqual([
      expect.objectContaining({
        status: "sent",
        userId,
        sessionId,
        characterName: "Aria",
        delivered: 1,
      }),
    ]);
    expect(mocks.complete).toHaveBeenCalledOnce();
    expect(mocks.sendNotification).toHaveBeenCalledOnce();

    const typedMessages = await db
      .select()
      .from(chatMessages)
      .where(
        and(
          eq(chatMessages.userId, userId),
          eq(chatMessages.sessionId, sessionId),
          eq(chatMessages.role, "assistant"),
          eq(chatMessages.characterName, "Aria"),
        ),
      );
    const storedMessages = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, "ChatMessage"),
        ),
      );
    expect(
      typedMessages.some(
        (message) =>
          (message.metadata as Record<string, unknown>).source ===
          "proactive_push",
      ),
    ).toBe(true);
    expect(
      storedMessages.some(
        (row) =>
          (row.data as Record<string, unknown>).proactive === true &&
          (row.data as Record<string, unknown>).character_name === "Aria",
      ),
    ).toBe(true);
  });
});
