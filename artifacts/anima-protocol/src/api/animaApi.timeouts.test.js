import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(srcRoot, "../../..");

describe("chat stream client error handling", () => {
  it("parses JSON error responses on non-OK status instead of throwing raw API error status strings", () => {
    const animaApi = readFileSync(join(srcRoot, "api/animaApi.js"), "utf8");
    expect(animaApi).toContain("const err = await res.json().catch(() => ({ error: res.statusText }));");
    expect(animaApi).toContain("throw chatHttpError(err, res.status)");
  });
});

describe("chat stream client abort", () => {
  it("stays above the Worker free-tier open budget so hops are not aborted in the browser", () => {
    const animaApi = readFileSync(join(srcRoot, "api/animaApi.js"), "utf8");
    expect(animaApi).toContain("export const CHAT_STREAM_TIMEOUT_MS = 140_000");
    expect(animaApi).toContain("export const CHAT_FETCH_ABORT_MS = 310_000");
    expect(animaApi).toContain("setTimeout(() => controller.abort(), CHAT_FETCH_ABORT_MS)");
    expect(animaApi).toContain("if (controller.signal.aborted)");
    expect(animaApi).toContain('cancel.code = "chat_user_cancel"');
    expect(animaApi).toContain("requireChatAuthHeaders");
  });

  it("matches the api-server documented client budget", () => {
    const serverTimeouts = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/chatTimeouts.ts"),
      "utf8",
    );
    expect(serverTimeouts).toMatch(
      /CHAT_STREAM_TIMEOUT_MS =\s*LLM_OPEN_TIMEOUT_FREE_TIER_MS \+\s*LLM_STREAM_FIRST_CHUNK_MS \+\s*CHAT_MESSAGES_CONTEXT_SLACK_MS/,
    );
    expect(serverTimeouts).toMatch(/LLM_OPEN_TIMEOUT_FREE_TIER_MS = 80_000/);
    expect(serverTimeouts).toMatch(/LLM_STREAM_FIRST_CHUNK_MS = 50_000/);
    expect(serverTimeouts).toMatch(/LLM_LOCAL_SLOT_WAIT_MS = 180_000/);
    expect(serverTimeouts).toMatch(
      /CHAT_FETCH_ABORT_MS =\s*LLM_LOCAL_SLOT_WAIT_MS \+\s*LLM_LOCAL_FIRST_TOKEN_MS \+\s*LLM_LOCAL_DECODE_SLACK_MS \+\s*CHAT_MESSAGES_CONTEXT_SLACK_MS/,
    );
  });
});
