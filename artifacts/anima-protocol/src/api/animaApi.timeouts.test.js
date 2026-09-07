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
    expect(animaApi).toContain("throw new Error(err.error || err.message || res.statusText || `API error: ${res.status}`);");
  });
});

describe("chat stream client abort", () => {
  it("stays above the Worker free-tier open budget so hops are not aborted in the browser", () => {
    const animaApi = readFileSync(join(srcRoot, "api/animaApi.js"), "utf8");
    expect(animaApi).toContain("export const CHAT_STREAM_TIMEOUT_MS = 115_000");
    expect(animaApi).toContain("setTimeout(() => controller.abort(), CHAT_STREAM_TIMEOUT_MS)");
  });

  it("matches the api-server documented client budget", () => {
    const serverTimeouts = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/chatTimeouts.ts"),
      "utf8",
    );
    expect(serverTimeouts).toMatch(
      /CHAT_STREAM_TIMEOUT_MS =\s*LLM_OPEN_TIMEOUT_FREE_TIER_MS \+ LLM_STREAM_FIRST_CHUNK_MS/,
    );
    expect(serverTimeouts).toMatch(/LLM_OPEN_TIMEOUT_FREE_TIER_MS = 80_000/);
    expect(serverTimeouts).toMatch(/LLM_STREAM_FIRST_CHUNK_MS = 35_000/);
  });
});
