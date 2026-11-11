import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CHAT_FAILURE_PHASES,
  CHAT_FAILURE_TYPES,
  chatFailureTypeById,
} from "./chatFailureTypes.js";

describe("chat failure types", () => {
  it("lists stable ids on the server failure phases, with room for later copy", () => {
    expect([...CHAT_FAILURE_PHASES]).toEqual(["queue", "prefill", "decode", "post"]);
    const ids = CHAT_FAILURE_TYPES.map((entry) => entry.id);
    expect(ids).toEqual([
      "queue",
      "prefill",
      "decode",
      "post",
      "queue_waiting",
      "queue_timeout",
      "no_first_token",
      "stream_dropped",
      "network_lost",
      "auth_expired",
      "server_error",
      "save_failed",
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of CHAT_FAILURE_TYPES) {
      expect(CHAT_FAILURE_PHASES).toContain(entry.phase);
      expect(entry.userMessage).toBeNull();
      expect(entry.description.length).toBeGreaterThan(20);
      expect(entry.description.length).toBeLessThan(180);
      expect(chatFailureTypeById(entry.id)).toBe(entry);
    }
    expect(chatFailureTypeById("not-a-type")).toBeNull();
  });

  it("does not feed the catalog into today's HUD copy", () => {
    const hud = readFileSync(path.resolve("src/lib/chatTurnError.js"), "utf8");
    expect(hud).not.toContain("chatFailureTypes");
    expect(hud).not.toContain("userMessage");
  });
});
