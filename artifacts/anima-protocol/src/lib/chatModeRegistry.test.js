import { describe, expect, it } from "vitest";
import { CHAT_MODES, resolveClientChatMode } from "./chatModeRegistry";

describe("resolveClientChatMode", () => {
  it("gives therapy precedence over adult settings", () => {
    expect(resolveClientChatMode({ therapy: true, adult: true })).toBe(
      CHAT_MODES.therapy,
    );
    expect(CHAT_MODES.therapy.adultAllowed).toBe(false);
  });

  it("uses explicit crossover policy for multi-universe sessions", () => {
    expect(resolveClientChatMode({ crossover: true, adult: true })).toBe(
      CHAT_MODES.crossover,
    );
    expect(CHAT_MODES.crossover.promptModules).toContain("crossover");
  });
});
