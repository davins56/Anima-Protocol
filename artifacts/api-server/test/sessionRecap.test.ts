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

const createMock = vi.hoisted(() => vi.fn(async (_args: unknown) => ({ content: "" })));

vi.mock("../src/lib/llmFailover", () => ({
  createChatCompletionWithFailover: createMock,
  isLocalOnlyProviderChain: () => false,
  LocalModelHeldForChatError: class LocalModelHeldForChatError extends Error {},
}));

import { db, userEntities } from "@workspace/db";
import functionsRouter from "../src/routes/openai/functions";
import {
  buildRecapTranscript,
  generateSessionRecap,
  parseRecapResponse,
  recapLines,
} from "../src/lib/sessionRecap";

const USER = "user_session_recap";
const OTHER = "user_session_recap_other";
const SESSION = "sess_recap_1";

const MODEL_JSON = JSON.stringify({
  title: "Rooftop Confessions",
  summary: "Natasha and the user met on the rooftop and talked through the mission fallout.",
  key_moments: ["She admits the mission went wrong", "They agree to train together"],
  characters_involved: ["Natasha Romanoff"],
  emotional_arc: "Guarded at first, then candid, ending warm and hopeful.",
  journal_entry: "Tonight the walls came down a little.",
  reflections: ["Ask about Budapest next time"],
});

describe("sessionRecap helpers", () => {
  it("keeps only visible chat lines with speaker names", () => {
    const lines = recapLines([
      { role: "user", content: "Hi Nat" },
      { role: "assistant", content: "...", character_name: "__typing__" },
      { role: "system", content: "hidden" },
      { role: "assistant", content: "Hey you.", character_name: "Natasha Romanoff" },
      { role: "assistant", content: "   " },
      { role: "user", content: "..." },
    ]);
    // A user's own "..." is a real turn; only the typing placeholder is dropped.
    expect(lines).toEqual(["User: Hi Nat", "Natasha Romanoff: Hey you.", "User: ..."]);
  });

  it("covers the whole session, not just the last 20 messages", () => {
    const messages = Array.from({ length: 101 }, (_, i) => ({
      role: i % 2 ? "assistant" : "user",
      character_name: i % 2 ? "Natasha Romanoff" : undefined,
      content: `message number ${i} ${"x".repeat(200)}`,
    }));
    const transcript = buildRecapTranscript(messages, 8_000);
    // Kept lines fit the budget; only the short "omitted" markers are extra.
    const kept = transcript
      .split("\n")
      .filter((l) => !l.startsWith("[…"))
      .reduce((n, l) => n + l.length + 1, 0);
    expect(kept).toBeLessThanOrEqual(8_000);
    expect(transcript.length).toBeLessThanOrEqual(8_000 + 40 * 30);
    expect(transcript).toContain("message number 0 ");
    expect(transcript).toContain("message number 100 ");
    // Something from the middle survives, and the gap is marked.
    expect(transcript).toMatch(/message number (4\d|5\d|6\d) /);
    expect(transcript).toContain("omitted");
    // Small sessions are sent whole.
    expect(buildRecapTranscript(messages.slice(0, 5))).not.toContain("omitted");
  });

  it("parses fenced JSON and treats plain prose as the summary", () => {
    const parsed = parseRecapResponse("```json\n" + MODEL_JSON + "\n```");
    expect(parsed.summary).toContain("rooftop");
    expect(parsed.emotional_arc).toContain("Guarded");
    expect(parsed.key_moments).toHaveLength(2);
    expect(parseRecapResponse("Just a sentence.").summary).toBe("Just a sentence.");
    // Broken JSON is a failed reply, never shown as the summary.
    expect(parseRecapResponse('{"title": "Cut off", "summary": "Nat').summary).toBe("");
    expect(parseRecapResponse("```json\n{\"summary\": ").summary).toBe("");
  });

  it("sends the loaded messages to the model and never invents a fallback", async () => {
    const complete = vi.fn(async () => MODEL_JSON);
    const recap = await generateSessionRecap(USER, SESSION, {
      loadMessages: async () => [
        { role: "user", content: "The mission went sideways." },
        { role: "assistant", content: "I know. I was there.", character_name: "Natasha Romanoff" },
      ],
      complete,
    });
    expect(recap.generated).toBe(true);
    expect(recap.message_count).toBe(2);
    expect(complete.mock.calls[0][1]).toContain("The mission went sideways.");

    const failed = await generateSessionRecap(USER, SESSION, {
      loadMessages: async () => [{ role: "user", content: "hello" }],
      complete: async () => {
        throw new Error("model down");
      },
    });
    expect(failed.generated).toBe(false);
    expect(failed.summary).toBe("");
    expect(failed.emotional_arc).toBe("");
    expect(failed.error).toMatch(/try again/i);
  });
});

describe("POST /openai/invoke/generateSessionSummary", () => {
  let server: Server;
  let baseUrl = "";

  async function cleanup() {
    for (const userId of [USER, OTHER]) {
      await db.delete(userEntities).where(eq(userEntities.userId, userId));
    }
  }

  async function seedMessage(userId: string, seq: number, msg: Record<string, unknown>) {
    await db.insert(userEntities).values({
      userId,
      entityName: "ChatMessage",
      entityId: `${userId}_m${seq}`,
      data: { id: `${userId}_m${seq}`, session_id: SESSION, seq, ...msg },
    });
  }

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json());
    app.use("/openai", functionsRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await cleanup();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  beforeEach(async () => {
    await cleanup();
    createMock.mockReset();
    createMock.mockImplementation(async () => ({ content: MODEL_JSON }));
  });

  async function invoke(userId: string, body: Record<string, unknown>) {
    const res = await fetch(`${baseUrl}/openai/invoke/generateSessionSummary`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-user": userId },
      body: JSON.stringify(body),
    });
    return { status: res.status, json: (await res.json()) as { result?: any } };
  }

  it("summarises the stored session messages when the client sends only session_id", async () => {
    // Inserted out of order: the transcript must follow seq, not insert order.
    await seedMessage(USER, 1, {
      role: "assistant",
      content: "I know. Meet me on the roof.",
      character_name: "Natasha Romanoff",
    });
    await seedMessage(USER, 0, { role: "user", content: "Nat, the mission went sideways." });
    await seedMessage(OTHER, 0, { role: "user", content: "someone else's secret" });

    const res = await invoke(USER, { session_id: SESSION });
    expect(res.status).toBe(200);
    const data = res.json.result?.data;
    // The exact shape SessionRecapModal reads.
    expect(data.generated).toBe(true);
    expect(data.summary).toContain("rooftop");
    expect(data.emotional_arc).toContain("Guarded");
    expect(data.key_moments).toEqual([
      "She admits the mission went wrong",
      "They agree to train together",
    ]);
    expect(data.message_count).toBe(2);

    const prompt = JSON.stringify(createMock.mock.calls[0][0]);
    expect(prompt).toContain("the mission went sideways");
    expect(prompt).toContain(
      "User: Nat, the mission went sideways.\\nNatasha Romanoff: I know. Meet me on the roof.",
    );
    expect(prompt).not.toContain("No messages yet");
    expect(prompt).not.toContain("someone else's secret");
  });

  it("falls back to a legacy ChatSession.messages blob", async () => {
    await db.insert(userEntities).values({
      userId: USER,
      entityName: "ChatSession",
      entityId: SESSION,
      data: { id: SESSION, messages: [{ role: "user", content: "legacy hello" }] },
    });
    const res = await invoke(USER, { session_id: SESSION });
    expect(res.json.result?.data.generated).toBe(true);
    expect(JSON.stringify(createMock.mock.calls[0][0])).toContain("legacy hello");
    const rows = await db
      .select()
      .from(userEntities)
      .where(and(eq(userEntities.userId, USER), eq(userEntities.entityName, "ChatMessage")));
    expect(rows).toHaveLength(0); // read-only: no lazy migration from the recap
  });

  it("merges unmigrated legacy blob messages after existing rows, skipping duplicates", async () => {
    await seedMessage(USER, 0, { role: "user", content: "row one" });
    await db.insert(userEntities).values({
      userId: USER,
      entityName: "ChatSession",
      entityId: SESSION,
      data: {
        id: SESSION,
        messages: [
          { id: `${USER}_m0`, role: "user", content: "row one" },
          { id: "blob-2", role: "assistant", content: "blob only reply", character_name: "Natasha Romanoff" },
        ],
      },
    });
    const res = await invoke(USER, { session_id: SESSION });
    expect(res.json.result?.data.message_count).toBe(2);
    const prompt = JSON.stringify(createMock.mock.calls[0][0]);
    expect(prompt).toContain("User: row one\\nNatasha Romanoff: blob only reply");

    // Once the session is flagged migrated, a stale blob is ignored.
    await db
      .update(userEntities)
      .set({ data: { id: SESSION, messages_migrated: true, messages: [{ role: "user", content: "stale" }] } })
      .where(and(eq(userEntities.userId, USER), eq(userEntities.entityName, "ChatSession")));
    createMock.mockClear();
    await invoke(USER, { session_id: SESSION });
    expect(JSON.stringify(createMock.mock.calls[0][0])).not.toContain("stale");
  });

  it("reports an empty session without calling the model", async () => {
    const res = await invoke(USER, { session_id: "missing" });
    expect(res.status).toBe(200);
    expect(res.json.result?.data.generated).toBe(false);
    expect(res.json.result?.data.error).toMatch(/no messages/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("says the model failed instead of returning placeholder text", async () => {
    await seedMessage(USER, 0, { role: "user", content: "hello" });
    createMock.mockImplementation(async () => {
      throw new Error("provider down");
    });
    const res = await invoke(USER, { session_id: SESSION });
    expect(res.status).toBe(200);
    expect(res.json.result?.data.generated).toBe(false);
    expect(res.json.result?.data.summary).toBe("");
    expect(res.json.result?.data.error).toMatch(/did not answer.*try again/i);
    expect(res.json.result?.data.message_count).toBe(1);
  });
});
