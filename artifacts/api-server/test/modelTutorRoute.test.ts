import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: null,
  }),
  createClerkClient: () => ({
    users: { getUser: async () => ({ emailAddresses: [], primaryEmailAddressId: null }) },
  }),
}));

const draftCompletion = vi.fn();
vi.mock("../src/lib/llmFailover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/llmFailover")>()),
  createChatCompletionWithFailover: (...args: unknown[]) => draftCompletion(...args),
}));

import { and, eq, like } from "drizzle-orm";
import { db, userEntities, userProfiles } from "@workspace/db";
import modelTutorRouter from "../src/routes/modelTutor";
import {
  MODEL_LESSON_ENTITY,
  MODEL_TUTOR_PARTITION,
  readOwnModelChatPreference,
} from "../src/lib/modelTutorStore";
import { lessonIdFor, type ModelLesson } from "../src/lib/modelTutor";
import { OWN_MODEL_NOT_CONFIGURED_HINT, resetOwnModelForTests } from "../src/lib/ownModel";

const PREFIX = `tutor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const STEWARD = `${PREFIX}steward`;
const SAVED_ENV = { ...process.env };

// ---- stub of server/server.py's lesson API -------------------------------

type Handler = (body: Record<string, unknown>) => { status: number; body: unknown };
const calls: { method: string; path: string; body: Record<string, unknown>; auth?: string }[] = [];
const routes = new Map<string, Handler>();
let stub: Server;
let stubOrigin = "";

function setRoute(method: string, path: string, handler: Handler) {
  routes.set(`${method} ${path}`, handler);
}

function modelStatus(overrides: Record<string, unknown> = {}) {
  return {
    model: "anima-own",
    version: 3,
    base: "ckpt.pt",
    params: 13_400_000,
    block_size: 256,
    device: "cpu",
    lessons_stored: 0,
    lessons_learned: 0,
    learned_ids: [],
    forgotten_pending: 0,
    training: false,
    queue: 0,
    current_job: null,
    recent_jobs: [],
    can_rollback: true,
    ...overrides,
  };
}

function resetStub() {
  calls.length = 0;
  routes.clear();
  setRoute("GET", "/v1/lessons/status", () => ({ status: 200, body: modelStatus() }));
  setRoute("POST", "/v1/lessons", (body) => ({
    status: 200,
    body: {
      status: "done",
      job_id: "job-learn",
      kind: "learn",
      result: {
        version: 4,
        lesson_id: body.id,
        loss_before: 5.25,
        loss_after: 0.31,
        steps: 14,
        after_reply: body.chosen,
      },
    },
  }));
}

beforeAll(async () => {
  stub = createServer((req: IncomingMessage, res: ServerResponse) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const path = (req.url || "").split("?")[0]!;
      const body = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      calls.push({ method: req.method || "GET", path, body, auth: req.headers.authorization });
      const key = `${req.method} ${path}`;
      const handler =
        routes.get(key) ??
        [...routes.entries()].find(([k]) => k.endsWith("*") && key.startsWith(k.slice(0, -1)))?.[1];
      const out = handler ? handler(body) : { status: 404, body: { detail: "no stub route" } };
      res.writeHead(out.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out.body));
    });
  });
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  stubOrigin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

// ---- app ---------------------------------------------------------------

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/tutor", modelTutorRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function clearTutorData() {
  await db.delete(userEntities).where(eq(userEntities.userId, MODEL_TUTOR_PARTITION));
  await db.delete(userProfiles).where(like(userProfiles.userId, `${PREFIX}%`));
}

beforeEach(async () => {
  process.env.ANIMA_RUNTIME = "node";
  process.env.ANIMA_OWN_LLM_BASE_URL = `${stubOrigin}/v1`;
  process.env.ANIMA_OWN_LLM_API_KEY = "own-token";
  process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = STEWARD;
  delete process.env.CLERK_SECRET_KEY;
  resetOwnModelForTests();
  resetStub();
  draftCompletion.mockReset();
  await clearTutorData();
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  resetOwnModelForTests();
});

afterAll(async () => {
  await clearTutorData();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  stub.closeAllConnections();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown, user = STEWARD) {
  const res = await fetch(`${baseUrl}/tutor${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

const LESSON = {
  session_id: "sess-1",
  message_id: "turn_1:assistant",
  context: [
    { role: "user", content: "I had a rough day." },
    { role: "assistant", content: "The day number 1746 was kind." },
    { role: "user", content: "Can you just listen?" },
    { role: "system", content: "never sent to the model" },
  ],
  rejected: "The day number 1746 was kind.",
  chosen: "Of course. I'm here — tell me what happened.",
  note: "Listen first, don't ramble.",
  source_brand: "own",
};

// ---- tests ---------------------------------------------------------------

describe("who may teach", () => {
  it("tells a non-steward they are not one, and refuses their lessons", async () => {
    const status = await call("GET", "/status", undefined, `${PREFIX}visitor`);
    expect(status.body).toEqual({ isSteward: false });
    const teach = await call("POST", "/lessons", LESSON, `${PREFIX}visitor`);
    expect(teach.status).toBe(403);
    expect(calls.filter((c) => c.path === "/v1/lessons")).toHaveLength(0);
  });

  it("requires a signed-in user", async () => {
    const res = await fetch(`${baseUrl}/tutor/status`);
    expect(res.status).toBe(401);
  });
});

describe("teaching", () => {
  it("stores the lesson, teaches the model, and records what it learned", async () => {
    const res = await call("POST", "/lessons", LESSON);
    expect(res.status).toBe(201);
    const lesson = res.body.lesson as ModelLesson;
    expect(lesson).toMatchObject({
      id: lessonIdFor({ sessionId: "sess-1", messageId: "turn_1:assistant", part: null }),
      status: "learned",
      version: 4,
      loss_before: 5.25,
      loss_after: 0.31,
      steps: 14,
      after_reply: LESSON.chosen,
      note: LESSON.note,
      taught_by: STEWARD,
    });
    expect(lesson.context).toEqual([
      { role: "user", content: "I had a rough day." },
      { role: "assistant", content: "The day number 1746 was kind." },
      { role: "user", content: "Can you just listen?" },
    ]);

    const sent = calls.find((c) => c.method === "POST" && c.path === "/v1/lessons")!;
    expect(sent.auth).toBe("Bearer own-token");
    expect(sent.body).toMatchObject({
      id: lesson.id,
      chosen: LESSON.chosen,
      rejected: LESSON.rejected,
      messages: lesson.context,
      wait: 15,
    });

    const listed = await call("GET", "/lessons");
    expect(listed.body.lessons.map((l: ModelLesson) => l.id)).toEqual([lesson.id]);
  });

  it("refines the same reply's lesson instead of stacking a second one", async () => {
    const first = (await call("POST", "/lessons", LESSON)).body.lesson as ModelLesson;
    const second = (await call("POST", "/lessons", { ...LESSON, chosen: "I'm listening." }))
      .body.lesson as ModelLesson;
    expect(second.id).toBe(first.id);
    expect(second.created_date).toBe(first.created_date);
    expect(second.chosen).toBe("I'm listening.");
    expect((await call("GET", "/lessons")).body.lessons).toHaveLength(1);
  });

  it("rejects a lesson without a better reply", async () => {
    const res = await call("POST", "/lessons", { ...LESSON, chosen: "  " });
    expect(res.status).toBe(400);
  });

  it("hands back a job to poll when learning takes longer", async () => {
    setRoute("POST", "/v1/lessons", () => ({
      status: 202,
      body: { status: "running", job_id: "job-slow", kind: "learn" },
    }));
    const taught = await call("POST", "/lessons", LESSON);
    expect(taught.body.lesson).toMatchObject({ status: "learning", job_id: "job-slow" });

    setRoute("GET", "/v1/lessons/jobs/job-slow", () => ({
      status: 200,
      body: {
        status: "done",
        job_id: "job-slow",
        kind: "learn",
        result: { version: 7, loss_before: 4, loss_after: 0.3, steps: 30, after_reply: "ok" },
      },
    }));
    const polled = await call("GET", `/jobs/job-slow?lesson_id=${taught.body.lesson.id}`);
    expect(polled.body.job.status).toBe("done");
    expect(polled.body.lesson).toMatchObject({ status: "learned", version: 7, after_reply: "ok" });
  });

  it("records a failed learning job on the lesson", async () => {
    setRoute("POST", "/v1/lessons", () => ({
      status: 500,
      body: { status: "failed", job_id: "job-bad", kind: "learn", error: "out of memory", detail: "out of memory" },
    }));
    const res = await call("POST", "/lessons", LESSON);
    expect(res.body.lesson).toMatchObject({ status: "failed", error: "out of memory" });
  });

  it("keeps the lesson when the model is offline, to teach on the next sync", async () => {
    process.env.ANIMA_OWN_LLM_BASE_URL = "http://127.0.0.1:1/v1";
    const res = await call("POST", "/lessons", LESSON);
    expect(res.status).toBe(201);
    expect(res.body.lesson.status).toBe("saved");
    expect(res.body.lesson.error).toContain("isn't reachable");
  });

  it("saves lessons even before a model is connected", async () => {
    delete process.env.ANIMA_OWN_LLM_BASE_URL;
    const res = await call("POST", "/lessons", LESSON);
    expect(res.body.lesson).toMatchObject({ status: "saved", error: OWN_MODEL_NOT_CONFIGURED_HINT });
  });
});

describe("forgetting, relearning and undo", () => {
  it("deletes a lesson and says a sync is needed to forget it", async () => {
    const lesson = (await call("POST", "/lessons", LESSON)).body.lesson as ModelLesson;
    setRoute("DELETE", `/v1/lessons/${lesson.id}`, () => ({
      status: 200,
      body: { removed: true, was_learned: true },
    }));
    const res = await call("DELETE", `/lessons/${lesson.id}`);
    expect(res.body).toEqual({ deleted: true, needs_sync: true });
    expect((await call("GET", "/lessons")).body.lessons).toHaveLength(0);
    expect((await call("DELETE", `/lessons/${lesson.id}`)).status).toBe(404);
  });

  it("relearns every stored lesson from the base checkpoint", async () => {
    await call("POST", "/lessons", LESSON);
    await call("POST", "/lessons", { ...LESSON, message_id: "turn_2:assistant", chosen: "Hi." });
    setRoute("POST", "/v1/lessons/sync", () => ({
      status: 202,
      body: { status: "queued", job_id: "job-sync", kind: "rebuild" },
    }));
    const res = await call("POST", "/sync");
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ lessons: 2, job: { job_id: "job-sync" } });
    const sent = calls.find((c) => c.path === "/v1/lessons/sync")!;
    expect(sent.body.rebuild).toBe(true);
    expect((sent.body.lessons as unknown[]).length).toBe(2);
  });

  it("undoes the last lesson", async () => {
    setRoute("POST", "/v1/lessons/rollback", () => ({
      status: 200,
      body: { status: "done", job_id: "job-undo", kind: "rollback", result: { version: 3, undid: 4 } },
    }));
    const res = await call("POST", "/rollback");
    expect(res.body.job).toMatchObject({ status: "done", result: { undid: 4 } });
  });

  it("brings stored statuses in line with what the weights know", async () => {
    const lesson = (await call("POST", "/lessons", LESSON)).body.lesson as ModelLesson;
    expect(lesson.status).toBe("learned");
    // The model server restarted on a fresh volume: it knows nothing.
    const status = await call("GET", "/status");
    expect(status.body).toMatchObject({
      isSteward: true,
      configured: true,
      reachable: true,
      lessons_total: 1,
      needs_sync: true,
      model: { version: 3, block_size: 256 },
    });
    expect(status.body.model.learned_ids).toBeUndefined();
    const [row] = await db
      .select({ data: userEntities.data })
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, MODEL_TUTOR_PARTITION),
          eq(userEntities.entityName, MODEL_LESSON_ENTITY),
          eq(userEntities.entityId, lesson.id),
        ),
      );
    expect((row!.data as ModelLesson).status).toBe("saved");
  });

  it("reports an unreachable model without failing the panel", async () => {
    process.env.ANIMA_OWN_LLM_BASE_URL = "http://127.0.0.1:1/v1";
    const status = await call("GET", "/status");
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ configured: true, reachable: false, model: null });
    expect(status.body.error).toContain("isn't reachable");
  });
});

describe("advice and drafting", () => {
  it("keeps standing advice and uses it to draft a better reply", async () => {
    const added = await call("POST", "/advice", { text: "Ask a gentle follow-up question." });
    expect(added.status).toBe(201);
    expect((await call("POST", "/advice", { text: "   " })).status).toBe(400);
    expect((await call("GET", "/advice")).body.advice.map((a: { text: string }) => a.text)).toEqual([
      "Ask a gentle follow-up question.",
    ]);

    draftCompletion.mockResolvedValue({
      content: '"I\'m here. What happened today?"',
      model: "anima-chat",
      brand: "anima",
    });
    const res = await call("POST", "/lessons/draft", {
      context: LESSON.context,
      rejected: LESSON.rejected,
      note: LESSON.note,
    });
    expect(res.body).toMatchObject({ draft: "I'm here. What happened today?", brand: "anima" });
    const request = draftCompletion.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const prompt = request.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Ask a gentle follow-up question.");
    expect(prompt).toContain(LESSON.note);
    expect(prompt).toContain(LESSON.rejected);

    const id = added.body.advice.id as string;
    expect((await call("DELETE", `/advice/${id}`)).body).toEqual({ deleted: true });
    expect((await call("GET", "/advice")).body.advice).toEqual([]);
  });

  it("says so when Anima cannot draft", async () => {
    draftCompletion.mockRejectedValue(new Error("down"));
    const res = await call("POST", "/lessons/draft", { context: [], rejected: "x" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("draft_failed");
  });
});

describe("preferences and export", () => {
  it("switches the steward's chats to their model without touching other settings", async () => {
    await db.insert(userProfiles).values({
      userId: STEWARD,
      data: { settings: { theme_mode: "light" }, display_name: "Dàvīn" },
    });
    const res = await call("PUT", "/preferences", { own_model_chat: true });
    expect(res.body).toEqual({ preferences: { own_model_chat: true } });
    expect(await readOwnModelChatPreference(STEWARD)).toBe(true);
    const [row] = await db.select().from(userProfiles).where(eq(userProfiles.userId, STEWARD));
    expect(row!.data).toMatchObject({
      settings: { theme_mode: "light" },
      display_name: "Dàvīn",
      model_tutor: { own_model_chat: true },
    });
    await call("PUT", "/preferences", { own_model_chat: false });
    expect(await readOwnModelChatPreference(STEWARD)).toBe(false);
  });

  it("will not switch chats to a model that is not connected", async () => {
    delete process.env.ANIMA_OWN_LLM_BASE_URL;
    const res = await call("PUT", "/preferences", { own_model_chat: true });
    expect(res.status).toBe(409);
  });

  it("exports lessons in the formats phases 2 and 3 read", async () => {
    await call("POST", "/lessons", LESSON);
    const sftRes = await call("GET", "/export?format=sft");
    expect(sftRes.headers.get("content-disposition")).toContain("steward_lessons.jsonl");
    const sftLine = JSON.parse(sftRes.text.trim());
    expect(sftLine.messages).toEqual([
      { role: "user", content: "I had a rough day." },
      { role: "anima", content: "The day number 1746 was kind.", train: false },
      { role: "user", content: "Can you just listen?" },
      { role: "anima", content: LESSON.chosen },
    ]);
    const dpoRes = await call("GET", "/export?format=dpo");
    expect(dpoRes.headers.get("content-disposition")).toContain("steward_preferences.jsonl");
    expect(JSON.parse(dpoRes.text.trim())).toMatchObject({
      chosen: LESSON.chosen,
      rejected: LESSON.rejected,
    });
  });
});
