import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const chatCompletions = vi.fn();

vi.mock("./animaApi", () => ({
  animaApi: {
    chatCompletions: (...args) => chatCompletions(...args),
  },
  chatHttpError: (err, status) => {
    const error = new Error(err?.error || `API error: ${status}`);
    error.status = status;
    return error;
  },
  requireChatAuthHeaders: vi.fn(async () => ({ Authorization: "Bearer test" })),
}));

vi.mock("./authBridge", () => ({
  authHeaders: vi.fn(async () => ({ Authorization: "Bearer test" })),
  clearAuthTokenGetter: vi.fn(),
  getToken: vi.fn(),
  hasAuthTokenGetter: vi.fn(() => true),
  awaitCompanionStoreAuth: vi.fn(),
  resolveStoreToken: vi.fn(),
  setAuthTokenGetter: vi.fn(),
  waitForStoreAuth: vi.fn(),
}));

import { base44 } from "./base44Client";

const chatSource = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../pages/Chat.jsx"),
  "utf8",
);

function sliceFrom(source, marker, length) {
  const start = source.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  return source.slice(start, start + length);
}

describe("Chat sidecar InvokeLLM calls", () => {
  beforeEach(() => {
    chatCompletions.mockReset();
  });

  it("marks the Book of Echoes journal call as a sidecar", () => {
    const journal = sliceFrom(chatSource, "Book of Echoes", 4500);
    expect(journal).toContain("sidecar: true");
    expect(journal).toContain("base44.integrations.Core.InvokeLLM");
    expect(journal).toContain("BookOfEcho.create");
  });

  it("marks the Serenity call as a sidecar and drops an empty reply", () => {
    const serenity = sliceFrom(chatSource, "const serenityPrompt", 4000);
    expect(serenity).toContain("sidecar: true");
    expect(serenity).toContain("if (!raw.trim()) return;");
    expect(serenity).toContain("appendAmbientMessage");
  });

  it("returns a canned journal object when the sidecar stream is skipped", async () => {
    chatCompletions.mockImplementation(async function* () {
      yield { done: true, skipped: true };
    });
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: "Write today's echo.",
      response_json_schema: { type: "object" },
      sidecar: true,
    });
    expect(result).toEqual({});
    expect(chatCompletions).toHaveBeenCalledWith(
      expect.objectContaining({ sidecar: true, content: "Write today's echo." }),
    );
  });

  it("returns an empty Serenity line when the sidecar stream is skipped", async () => {
    chatCompletions.mockImplementation(async function* () {
      yield { done: true, skipped: true };
    });
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: "Serenity speaks.",
      sidecar: true,
    });
    expect(result).toBe("");
  });

  it("still returns the model text when the sidecar stream is not skipped", async () => {
    chatCompletions.mockImplementation(async function* () {
      yield { content: '{"entry":"Today we laughed.","theme":"laughter"}' };
      yield { done: true };
    });
    const result = await base44.integrations.Core.InvokeLLM({
      prompt: "Write today's echo.",
      response_json_schema: {
        type: "object",
        properties: { entry: { type: "string" }, theme: { type: "string" } },
      },
      sidecar: true,
    });
    expect(result).toEqual({ entry: "Today we laughed.", theme: "laughter" });
  });
});
