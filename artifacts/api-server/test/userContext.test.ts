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

// Replace Clerk's getAuth with a stub that reads the user id from a test-only
// header so we can exercise the REAL functions router + REAL Postgres without a
// live Clerk session (mirrors store.test.ts).
vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

// The analysis JSON the (mocked) model returns for any text/vision call.
const MODEL_ANALYSIS = {
  extracted_summary: "A scanned journal page about resilience and family.",
  key_themes: ["resilience", "family"],
  personal_values: ["perseverance"],
  characters_mentioned: ["Mara"],
  extracted_text: "Dear diary, today I learned to keep going. — Mara",
};

const { createMock } = vi.hoisted(() => ({
  createMock: vi.fn(async () => ({
    choices: [
      {
        message: {
          content: JSON.stringify({
            extracted_summary: "A scanned journal page about resilience and family.",
            key_themes: ["resilience", "family"],
            personal_values: ["perseverance"],
            characters_mentioned: ["Mara"],
            extracted_text: "Dear diary, today I learned to keep going. — Mara",
          }),
        },
      },
    ],
  })),
}));

vi.mock("openai", () => {
  class OpenAI {
    chat = { completions: { create: createMock } };
    images = { edit: vi.fn() };
    responses = { create: vi.fn() };
  }
  return { default: OpenAI, toFile: vi.fn() };
});

import functionsRouter, {
  parseContextAnalysis,
  buildContextPromptString,
} from "../src/routes/openai/functions";
import { db, userEntities } from "@workspace/db";
import { and, eq, like } from "drizzle-orm";

const PREFIX = `uctest_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
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

async function seedContext(
  userId: string,
  id: string,
  data: Record<string, unknown>,
): Promise<void> {
  await db.insert(userEntities).values({
    userId,
    entityName: "UserContext",
    entityId: id,
    data: { id, ...data },
  });
}

async function readContext(
  userId: string,
  id: string,
): Promise<Record<string, unknown> | null> {
  const [row] = await db
    .select()
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, "UserContext"),
        eq(userEntities.entityId, id),
      ),
    )
    .limit(1);
  return row ? (row.data as Record<string, unknown>) : null;
}

describe("parseContextAnalysis", () => {
  it("parses a clean JSON object", () => {
    const a = parseContextAnalysis(JSON.stringify(MODEL_ANALYSIS));
    expect(a.extracted_summary).toContain("resilience");
    expect(a.key_themes).toEqual(["resilience", "family"]);
    expect(a.characters_mentioned).toEqual(["Mara"]);
  });

  it("tolerates code fences and surrounding prose", () => {
    const raw = "Here you go:\n```json\n" + JSON.stringify(MODEL_ANALYSIS) + "\n```";
    expect(parseContextAnalysis(raw).extracted_summary).toContain("resilience");
  });

  it("returns an empty analysis on garbage", () => {
    const a = parseContextAnalysis("not json at all");
    expect(a).toEqual({
      extracted_summary: "",
      key_themes: [],
      personal_values: [],
      characters_mentioned: [],
      extracted_text: "",
    });
  });

  it("drops non-string array entries", () => {
    const a = parseContextAnalysis(
      JSON.stringify({ key_themes: ["ok", 5, "", null, " x "] }),
    );
    expect(a.key_themes).toEqual(["ok", "x"]);
  });
});

describe("buildContextPromptString", () => {
  it("includes records with usable content and skips still-processing ones", () => {
    const prompt = buildContextPromptString([
      {
        title: "My Novel",
        document_type: "novel",
        extracted_summary: "A story of hope.",
        key_themes: ["hope"],
        is_active: true,
      },
      // still processing -> no usable fields -> skipped
      { title: "Pending", document_type: "essay", processing_complete: false },
    ]);
    expect(prompt).toContain("My Novel");
    expect(prompt).toContain("A story of hope.");
    expect(prompt).toContain("Themes: hope");
    expect(prompt).not.toContain("Pending");
  });

  it("returns an empty string when nothing is usable", () => {
    expect(buildContextPromptString([{ title: "x" }])).toBe("");
    expect(buildContextPromptString([])).toBe("");
  });
});

describe("processUserContext", () => {
  it("reads an uploaded image (vision) and stores the analysis on the record", async () => {
    const u = user("img");
    const id = "ctx_img_1";
    await seedContext(u, id, {
      title: "Journal Page",
      document_type: "journal",
      is_active: true,
      processing_complete: false,
    });

    const res = await invoke(u, "processUserContext", {
      user_context_id: id,
      is_image: true,
      image_data_url: "data:image/jpeg;base64,AAAA",
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.extracted_summary).toContain("resilience");
    expect(res.json.result.data.persisted).toBe(true);

    // The vision model was actually given the image.
    const call = createMock.mock.calls[0]?.[0] as any;
    const parts = call.messages[1].content;
    expect(Array.isArray(parts)).toBe(true);
    expect(parts.some((p: any) => p.type === "image_url")).toBe(true);

    const stored = await readContext(u, id);
    expect(stored?.processing_complete).toBe(true);
    expect(stored?.extracted_summary).toContain("resilience");
    expect(stored?.key_themes).toEqual(["resilience", "family"]);
    // Pre-existing fields are preserved.
    expect(stored?.title).toBe("Journal Page");
  });

  it("reads a text document from file_content (no image call shape)", async () => {
    const u = user("txt");
    const id = "ctx_txt_1";
    await seedContext(u, id, {
      title: "Essay",
      document_type: "essay",
      is_active: true,
      processing_complete: false,
    });

    const res = await invoke(u, "processUserContext", {
      user_context_id: id,
      is_image: false,
      file_content: "An essay about perseverance and family bonds.",
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.persisted).toBe(true);
    const call = createMock.mock.calls[0]?.[0] as any;
    // Text path sends a plain string user message, not a content-part array.
    expect(typeof call.messages[1].content).toBe("string");

    const stored = await readContext(u, id);
    expect(stored?.extracted_summary).toContain("resilience");
  });

  it("rejects unauthenticated callers before any model call (denial-of-wallet)", async () => {
    const res = await invoke(null, "processUserContext", {
      user_context_id: "whatever",
      is_image: true,
      image_data_url: "data:image/jpeg;base64,AAAA",
    });
    expect(res.status).toBe(401);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does nothing destructive when there is no usable input", async () => {
    const u = user("empty");
    const id = "ctx_empty_1";
    await seedContext(u, id, {
      title: "Empty",
      document_type: "other",
      is_active: true,
      processing_complete: false,
    });

    const res = await invoke(u, "processUserContext", {
      user_context_id: id,
      is_image: false,
      file_content: "   ",
    });

    expect(res.status).toBe(200);
    expect(res.json.result.data.extracted_summary).toBe("");
    expect(createMock).not.toHaveBeenCalled();
    const stored = await readContext(u, id);
    // Marked processed (so the UI stops spinning) but no fabricated content.
    expect(stored?.processing_complete).toBe(true);
    expect(stored?.extracted_summary ?? "").toBe("");
  });
});

describe("buildUserContextPrompt", () => {
  it("consolidates active records and counts them, ignoring inactive ones", async () => {
    const u = user("build");
    await seedContext(u, "b1", {
      title: "Reference Photo",
      document_type: "character_background",
      is_active: true,
      extracted_summary: "A portrait of the hero.",
      key_themes: ["courage"],
    });
    await seedContext(u, "b2", {
      title: "Disabled Doc",
      document_type: "novel",
      is_active: false,
      extracted_summary: "Should not appear.",
    });

    const res = await invoke(u, "buildUserContextPrompt", {});
    expect(res.status).toBe(200);
    const { context_prompt, context_count } = res.json.result.data;
    expect(context_count).toBe(1);
    expect(context_prompt).toContain("Reference Photo");
    expect(context_prompt).toContain("A portrait of the hero.");
    expect(context_prompt).not.toContain("Disabled Doc");
  });

  it("returns empty context for an unauthenticated request", async () => {
    const res = await invoke(null, "buildUserContextPrompt", {});
    expect(res.status).toBe(200);
    expect(res.json.result.data).toEqual({ context_prompt: "", context_count: 0 });
  });
});
