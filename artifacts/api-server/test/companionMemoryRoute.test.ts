import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import chatRouter from "../src/routes/chat";
import {
  companionMemories,
  db,
  ensureSchemaOnce,
  localLlmDeferredJobs,
  memoryEmbeddings,
  userEntities,
  userProfiles,
} from "@workspace/db";

const PREFIX = `memreview_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const ownerId = `${PREFIX}owner`;
const otherId = `${PREFIX}other`;
const characterId = `${PREFIX}natasha`;

const mood = { selfState: { intensity: 10 }, synchroStrength: 20 };
const characterData = {
  id: characterId,
  name: "Natasha Romanoff",
  personality: "ORIGINAL PERSONALITY",
  backstory: "ORIGINAL BACKSTORY",
  identity_lock: "LOCK",
};
const profileData = { operator_model: { preferred_name: "steward-note" } };

function fact(partial: Record<string, unknown>) {
  return {
    type: "factual",
    confidence: 0.8,
    emotional_weight: 0.3,
    identity_relevant: false,
    created_at: "2026-05-01T00:00:00.000Z",
    ...partial,
  };
}

const seedFacts = [
  fact({
    memory_class: "semantic",
    text: "The human's name is Sam.",
    subject: "user",
    predicate: "name",
    object: "Sam",
    about: "user",
    importance: 0.91,
    fact_id: "user-name",
  }),
  fact({
    memory_class: "episodic",
    text: "Natasha kept the key from the bridge.",
    subject: "companion",
    predicate: "kept",
    object: "the key",
    about: "companion",
    importance: 0.55,
    fact_id: "her-key",
    created_at: "2026-05-02T00:00:00.000Z",
  }),
  fact({
    memory_class: "core",
    text: "Protected identity proposal (not applied): Natasha Romanoff — is Natasha Romanoff.",
    subject: "companion",
    predicate: "is",
    object: "Natasha Romanoff",
    about: "companion",
    importance: 0.97,
    identity_relevant: true,
    protected: true,
    proposal: true,
    fact_id: "core-name",
  }),
  {
    type: "turn",
    turn_id: "old",
    text: "User: earlier | Companion: yes",
    created_at: "2026-01-01T00:00:00.000Z",
  },
];

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  await ensureSchemaOnce();
  const app: Express = express();
  app.use(express.json());
  app.use("/chat", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.userId, ownerId));
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.userId, ownerId));
  await db.delete(companionMemories).where(eq(companionMemories.userId, ownerId));
  await db.delete(companionMemories).where(eq(companionMemories.userId, otherId));
  await db.delete(userEntities).where(eq(userEntities.userId, ownerId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, ownerId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(async () => {
  await db.delete(localLlmDeferredJobs).where(eq(localLlmDeferredJobs.userId, ownerId));
  await db.delete(memoryEmbeddings).where(eq(memoryEmbeddings.userId, ownerId));
  await db.delete(companionMemories).where(eq(companionMemories.userId, ownerId));
  await db.delete(companionMemories).where(eq(companionMemories.userId, otherId));
  await db.delete(userEntities).where(eq(userEntities.userId, ownerId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, ownerId));
  await db.insert(userProfiles).values({ userId: ownerId, data: profileData });
  await db.insert(userEntities).values({
    userId: ownerId,
    entityName: "Character",
    entityId: characterId,
    data: characterData,
  });
  await db.insert(companionMemories).values({
    userId: ownerId,
    characterId,
    summary: "kept",
    facts: seedFacts,
    emotionalState: mood,
    resonanceNotes: "note",
  });
  await db.insert(memoryEmbeddings).values({
    userId: ownerId,
    characterId,
    factId: "user-name",
    text: "The human's name is Sam.",
    memoryType: "factual",
    embedding: [0.1, 0.2],
    model: "hash-bow-v1",
  });
});

function call(userId: string | null, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function storedRow() {
  const [memory] = await db
    .select()
    .from(companionMemories)
    .where(and(eq(companionMemories.userId, ownerId), eq(companionMemories.characterId, characterId)))
    .limit(1);
  return memory;
}

async function expectPersonaUntouched() {
  const memory = await storedRow();
  expect(memory?.summary).toBe("kept");
  expect(memory?.resonanceNotes).toBe("note");
  expect(memory?.emotionalState).toEqual(mood);
  const [character] = await db
    .select()
    .from(userEntities)
    .where(and(eq(userEntities.userId, ownerId), eq(userEntities.entityId, characterId)))
    .limit(1);
  expect(character?.data).toEqual(characterData);
  const [profile] = await db
    .select()
    .from(userProfiles)
    .where(eq(userProfiles.userId, ownerId))
    .limit(1);
  expect(profile?.data).toEqual(profileData);
}

describe("companion memory review route", () => {
  it("requires the signed-in user and only returns that user's memories", async () => {
    const anonymous = await call(null, "GET", `/chat/memories/${characterId}`);
    expect(anonymous.status).toBe(401);

    const owner = await call(ownerId, "GET", `/chat/memories/${characterId}`);
    expect(owner.status).toBe(200);
    const payload = (await owner.json()) as {
      review: {
        about_you: { fact_id: string; about: string; text: string }[];
        companion: { fact_id: string; about: string; text: string }[];
        core: { fact_id: string; editable: boolean; protected: boolean }[];
      };
    };
    expect(payload.review.about_you.map((item) => item.fact_id)).toEqual(["user-name"]);
    expect(payload.review.companion.map((item) => item.fact_id)).toEqual(["her-key"]);
    expect(payload.review.core.map((item) => item.fact_id)).toEqual(["core-name"]);
    expect(payload.review.about_you.every((item) => item.about === "user")).toBe(true);
    expect(payload.review.companion.every((item) => item.about === "companion")).toBe(true);
    expect(payload.review.core[0]).toMatchObject({ editable: false, protected: true });
    expect(JSON.stringify(payload.review)).not.toContain("User: earlier");
    expect(JSON.stringify(payload.review)).not.toMatch(/"importance"|"confidence"|"emotional_weight"/);

    const other = await call(otherId, "GET", `/chat/memories/${characterId}`);
    expect(other.status).toBe(200);
    const otherPayload = (await other.json()) as { review: { about_you: unknown[] } };
    expect(otherPayload.review.about_you).toEqual([]);
  });

  it("lets the owner correct a user fact without moving it onto the companion or calling a model", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    let response: Response;
    try {
    response = await call(ownerId, "PATCH", `/chat/memories/${characterId}/facts/user-name`, {
      text: "The human's name is Samuel.",
      about: "companion",
      memory_class: "core",
    });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      changed: boolean;
      review: { about_you: { fact_id: string; text: string; about: string }[]; companion: { text: string }[] };
    };
    expect(payload.changed).toBe(true);
    const corrected = payload.review.about_you.find((item) => item.text === "The human's name is Samuel.");
    expect(corrected).toMatchObject({ about: "user" });
    expect(corrected?.fact_id).not.toBe("user-name");
    expect(payload.review.companion.map((item) => item.text)).toEqual([
      "Natasha kept the key from the bridge.",
    ]);

    const memory = await storedRow();
    const saved = (memory?.facts || []).find(
      (item) => item && (item as { text?: string }).text === "The human's name is Samuel.",
    ) as {
      fact_id?: string;
      text?: string;
      about?: string;
      object?: string;
      value?: string;
      memory_class?: string;
      user_edited?: boolean;
    };
    expect(saved.text).toBe("The human's name is Samuel.");
    expect(saved.about).toBe("user");
    expect(saved.object).toBe("Samuel");
    expect(saved.value).toBe("Samuel");
    expect(saved.user_edited).toBe(true);
    expect(saved.memory_class).toBe("semantic");
    const tombstone = (memory?.facts || []).find(
      (item) => item && (item as { fact_id?: string }).fact_id === "user-name",
    ) as { forgotten?: boolean; object?: string; text?: string };
    expect(tombstone.forgotten).toBe(true);
    expect(tombstone.object).toBe("Sam");
    expect(tombstone.text).toBeUndefined();
    expect((memory?.facts || []).some((item) => (item as { type?: string }).type === "turn")).toBe(
      true,
    );
    await expectPersonaUntouched();

    const embeddings = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.userId, ownerId));
    expect(embeddings).toEqual([]);
    const jobs = await db
      .select()
      .from(localLlmDeferredJobs)
      .where(eq(localLlmDeferredJobs.userId, ownerId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.kind).toBe("memory-policy");
    expect(jobs[0]?.payload).toMatchObject({
      reembedOnly: true,
      userId: ownerId,
      characterId,
      factId: saved.fact_id,
    });
    const urls = fetchSpy.mock.calls.map((callArgs) => String(callArgs[0]));
    expect(urls.some((url) => /embeddings|openrouter|openai\.com|api\.openai/i.test(url))).toBe(false);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("refuses another user, and refuses edits or deletes of a protected proposal", async () => {
    const stolen = await call(otherId, "PATCH", `/chat/memories/${characterId}/facts/user-name`, {
      text: "The human's name is Eve.",
    });
    expect(stolen.status).toBe(404);
    const stolenDelete = await call(otherId, "DELETE", `/chat/memories/${characterId}/facts/her-key`);
    expect(stolenDelete.status).toBe(404);

    const coreEdit = await call(ownerId, "PATCH", `/chat/memories/${characterId}/facts/core-name`, {
      text: "Natasha is someone else.",
    });
    expect(coreEdit.status).toBe(403);
    const coreDelete = await call(ownerId, "DELETE", `/chat/memories/${characterId}/facts/core-name`);
    expect(coreDelete.status).toBe(403);

    const memory = await storedRow();
    const texts = (memory?.facts || []).map((item) => (item as { text?: string }).text);
    expect(texts).toContain("The human's name is Sam.");
    expect(texts).toContain("Natasha kept the key from the bridge.");
    expect(texts).toContain(
      "Protected identity proposal (not applied): Natasha Romanoff — is Natasha Romanoff.",
    );
    await expectPersonaUntouched();
  });

  it("deletes one of her memories through companion_memories and leaves the rest", async () => {
    await db.insert(memoryEmbeddings).values({
      userId: ownerId,
      characterId,
      factId: "her-key",
      text: "Natasha kept the key from the bridge.",
      memoryType: "factual",
      embedding: [0.3, 0.4],
      model: "hash-bow-v1",
    });
    const response = await call(ownerId, "DELETE", `/chat/memories/${characterId}/facts/her-key`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      changed: boolean;
      review: { companion: unknown[]; about_you: { fact_id: string }[]; core: { fact_id: string }[] };
    };
    expect(payload.changed).toBe(true);
    expect(payload.review.companion).toEqual([]);
    expect(payload.review.about_you.map((item) => item.fact_id)).toEqual(["user-name"]);
    expect(payload.review.core.map((item) => item.fact_id)).toEqual(["core-name"]);

    const memory = await storedRow();
    const her = (memory?.facts || []).find(
      (item) => item && (item as { fact_id?: string }).fact_id === "her-key",
    ) as { forgotten?: boolean; text?: string; object?: string };
    expect(her.forgotten).toBe(true);
    expect(her.object).toBe("the key");
    expect(her.text).toBeUndefined();
    const ids = (memory?.facts || []).map((item) => (item as { fact_id?: string }).fact_id);
    expect(ids).toContain("user-name");
    expect(ids).toContain("core-name");
    const embeddings = await db
      .select()
      .from(memoryEmbeddings)
      .where(eq(memoryEmbeddings.userId, ownerId));
    expect(embeddings.map((row) => row.factId)).toEqual(["user-name"]);
    expect((memory?.facts || []).some((item) => (item as { type?: string }).type === "turn")).toBe(
      true,
    );
    await expectPersonaUntouched();
  });
});
