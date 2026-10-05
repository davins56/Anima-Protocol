import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

// Stub Clerk: read the user id from a test-only header so we can exercise the
// REAL functions router + REAL Postgres without a live Clerk session.
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

// The memory-extraction model output is configurable per test.
const { createMock, setExtraction } = vi.hoisted(() => {
  let nextContent = "[]";
  return {
    setExtraction: (value: unknown) => {
      nextContent = typeof value === "string" ? value : JSON.stringify(value);
    },
    createMock: vi.fn(async () => ({
      choices: [{ message: { content: nextContent } }],
    })),
  };
});

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: createMock } };
    images = { edit: vi.fn() };
    responses = { create: vi.fn() };
  }
  return { default: OpenAI, toFile: vi.fn() };
});

import functionsRouter from "../src/routes/openai/functions";
import { db, userEntities } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";

const PREFIX = `cmtest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const user = (name: string) => `${PREFIX}${name}`;

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/openai", functionsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  createMock.mockClear();
  setExtraction("[]");
});

async function invoke(
  userId: string | null,
  fnName: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/openai/invoke/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { "x-test-user": userId } : {}),
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

async function countMemories(userId: string): Promise<number> {
  const rows = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, "CharacterMemory"),
      ),
    );
  return rows.length;
}

describe("characterMemory get", () => {
  it("returns an empty log for a character with no memories", async () => {
    const u = user("get_empty");
    const res = await invoke(u, "characterMemory", {
      action: "get",
      character_id: "char_a",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.memories).toEqual([]);
    // Pure read — never calls the model.
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns only the requested character's memories, newest first", async () => {
    const u = user("get_scoped");
    await db.insert(userEntities).values([
      {
        userId: u,
        entityName: "CharacterMemory",
        entityId: "m1",
        data: {
          id: "m1",
          character_id: "char_a",
          category: "preference",
          fact: "Likes tea.",
          created_date: "2026-01-01T00:00:00.000Z",
        },
      },
      {
        userId: u,
        entityName: "CharacterMemory",
        entityId: "m2",
        data: {
          id: "m2",
          character_id: "char_a",
          category: "event",
          fact: "Adopted a cat.",
          created_date: "2026-02-01T00:00:00.000Z",
        },
      },
      {
        userId: u,
        entityName: "CharacterMemory",
        entityId: "m3",
        data: {
          id: "m3",
          character_id: "char_b",
          category: "personal",
          fact: "Belongs to another character.",
          created_date: "2026-03-01T00:00:00.000Z",
        },
      },
    ]);

    const res = await invoke(u, "characterMemory", {
      action: "get",
      character_id: "char_a",
    });
    expect(res.status).toBe(200);
    const facts = res.json.result.data.memories.map((m: any) => m.fact);
    expect(facts).toEqual(["Adopted a cat.", "Likes tea."]);
  });
});

describe("characterMemory save", () => {
  it("extracts and persists new memories, then they are retrievable", async () => {
    const u = user("save_new");
    setExtraction([
      { category: "preference", fact: "Prefers to be called Sam." },
      { category: "event", fact: "Just started a new job." },
    ]);

    const res = await invoke(u, "characterMemory", {
      action: "save",
      character_id: "char_a",
      session_id: "sess_1",
      user_message: "Call me Sam. I just started a new job!",
      ai_response: "Congrats, Sam!",
      existing_memories: [],
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.created).toBe(2);
    expect(await countMemories(u)).toBe(2);

    const got = await invoke(u, "characterMemory", {
      action: "get",
      character_id: "char_a",
    });
    const facts = got.json.result.data.memories.map((m: any) => m.fact).sort();
    expect(facts).toEqual(["Just started a new job.", "Prefers to be called Sam."]);
    // Each stored memory carries the character + session tags.
    expect(
      got.json.result.data.memories.every((m: any) => m.character_id === "char_a"),
    ).toBe(true);
  });

  it("does not duplicate a fact already stored (case/spacing-insensitive)", async () => {
    const u = user("save_dedupe");
    await db.insert(userEntities).values({
      userId: u,
      entityName: "CharacterMemory",
      entityId: "existing",
      data: {
        id: "existing",
        character_id: "char_a",
        category: "preference",
        fact: "Prefers to be called Sam.",
        created_date: "2026-01-01T00:00:00.000Z",
      },
    });

    setExtraction([
      { category: "preference", fact: "  prefers   TO be called sam.  " },
      { category: "event", fact: "Moved to Berlin." },
    ]);

    const res = await invoke(u, "characterMemory", {
      action: "save",
      character_id: "char_a",
      session_id: "sess_2",
      user_message: "I moved to Berlin.",
      ai_response: "Exciting!",
    });
    expect(res.status).toBe(200);
    // Only the genuinely-new fact is written.
    expect(res.json.result.data.created).toBe(1);
    expect(await countMemories(u)).toBe(2);
  });

  it("creates nothing when the model finds no durable memories", async () => {
    const u = user("save_none");
    setExtraction("[]");
    const res = await invoke(u, "characterMemory", {
      action: "save",
      character_id: "char_a",
      user_message: "lol ok",
      ai_response: "haha",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.created).toBe(0);
    expect(await countMemories(u)).toBe(0);
  });

  it("tolerates malformed model output without throwing", async () => {
    const u = user("save_garbage");
    setExtraction("not json at all");
    const res = await invoke(u, "characterMemory", {
      action: "save",
      character_id: "char_a",
      user_message: "Something happened.",
      ai_response: "Tell me more.",
    });
    expect(res.status).toBe(200);
    expect(res.json.result.data.created).toBe(0);
    expect(await countMemories(u)).toBe(0);
  });
});

describe("characterMemory guards", () => {
  it("rejects unauthenticated callers with 401 (no model call)", async () => {
    const res = await invoke(null, "characterMemory", {
      action: "get",
      character_id: "char_a",
    });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("returns an empty result when character_id is missing", async () => {
    const u = user("no_char");
    const res = await invoke(u, "characterMemory", { action: "get" });
    expect(res.status).toBe(200);
    expect(res.json.result.data.memories).toEqual([]);
    expect(createMock).not.toHaveBeenCalled();
  });
});
