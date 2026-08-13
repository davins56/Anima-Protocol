import { describe, expect, it } from "vitest";
import {
  CHAT_MODE_REGISTRY,
  modePolicyPrompt,
  resolveChatModePolicy,
} from "../src/lib/chatModeRegistry";

describe("chat mode registry", () => {
  it("makes therapy override adult mode", () => {
    const policy = resolveChatModePolicy({ therapy: true, adult: true });
    expect(policy).toBe(CHAT_MODE_REGISTRY.therapy);
    expect(policy.adultAllowed).toBe(false);
    expect(policy.promptModules).toContain("therapy-safety");
  });

  it("defines crossover behavior declaratively", () => {
    const policy = resolveChatModePolicy({ isCrossover: true, adult: true });
    expect(policy.name).toBe("crossover");
    expect(policy.adultAllowed).toBe(false);
    expect(modePolicyPrompt(policy)).toMatch(/overrides client scene context/i);
  });
});
