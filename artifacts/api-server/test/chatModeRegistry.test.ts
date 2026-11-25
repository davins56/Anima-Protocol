import { describe, expect, it } from "vitest";
import {
  CHAT_MODE_REGISTRY,
  modePolicyPrompt,
  resolveChatModePolicy,
} from "../src/lib/chatModeRegistry";

describe("chat mode registry", () => {
  it("does not let a requested mode bypass the server adult decision", () => {
    expect(resolveChatModePolicy({ requestedMode: "adult", adult: false }).adultAllowed).toBe(false);
    expect(resolveChatModePolicy({ requestedMode: "adult", adult: true }).adultAllowed).toBe(true);
  });

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

  it("injects age and consent hard limits in both adult and non-adult contracts", () => {
    const adult = modePolicyPrompt(resolveChatModePolicy({ adult: true }));
    const standard = modePolicyPrompt(resolveChatModePolicy({ adult: false }));
    expect(adult).toMatch(/CONTENT RATING — ADULT/);
    expect(adult).toMatch(/HARD SAFETY — AGE \/ MINORS/);
    expect(adult).toMatch(/loli|shota/i);
    expect(adult).toMatch(/HARD SAFETY — CONSENT/);
    expect(standard).toMatch(/CONTENT RATING — RAW MODE/);
    expect(standard).toMatch(/HARD SAFETY — AGE \/ MINORS/);
    expect(standard).toMatch(/HARD SAFETY — CONSENT/);
    expect(standard).not.toMatch(/CONTENT RATING — ADULT \(18\+\) ENABLED/);
  });
});
