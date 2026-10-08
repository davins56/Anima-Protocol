import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHAT_FAILURE_PHASES as serverPhases,
  CHAT_FAILURE_TYPES as serverTypes,
} from "../src/lib/chatFailureTypes";
import {
  CHAT_FAILURE_PHASES as clientPhases,
  CHAT_FAILURE_TYPES as clientTypes,
} from "../../anima-protocol/src/lib/chatFailureTypes.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");

describe("chat failure type catalog", () => {
  it("keeps the client and server lists identical", () => {
    expect([...clientPhases]).toEqual([...serverPhases]);
    expect(clientTypes).toEqual(serverTypes);
  });

  it("uses the chat_pipeline failure phases and leaves user copy empty", () => {
    const telemetry = readFileSync(
      join(repoRoot, "artifacts/api-server/src/lib/chatTelemetry.ts"),
      "utf8",
    );
    const match = telemetry.match(/export type ChatFailurePhase = ([^;]+);/);
    expect(match).toBeTruthy();
    const phases = [...String(match?.[1]).matchAll(/"([^"]+)"/g)].map((item) => item[1]);
    expect(phases).toEqual([...serverPhases]);
    const ids = new Set<string>();
    for (const entry of serverTypes) {
      expect(phases).toContain(entry.phase);
      expect(entry.userMessage).toBeNull();
      expect(entry.description.trim().length).toBeGreaterThan(20);
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
    }
  });
});
