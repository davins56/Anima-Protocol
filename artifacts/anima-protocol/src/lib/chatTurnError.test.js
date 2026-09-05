import { describe, it, expect } from "vitest";
import { chatTurnErrorMessage } from "./chatTurnError.js";

describe("chatTurnErrorMessage", () => {
  it("keeps actionable API / network copy", () => {
    expect(chatTurnErrorMessage(new Error("No LLM provider has remaining quota."))).toBe(
      "No LLM provider has remaining quota.",
    );
  });

  it("hides Temporal Dead Zone / minified engine errors", () => {
    expect(chatTurnErrorMessage(new ReferenceError("Cannot access 'H' before initialization."))).toBe(
      "The companion could not reply. Please try again.",
    );
    expect(chatTurnErrorMessage(new TypeError("H is not a function"))).toBe(
      "The companion could not reply. Please try again.",
    );
  });

  it("falls back when the failure has no message", () => {
    expect(chatTurnErrorMessage(null)).toBe("The companion could not reply. Please try again.");
  });

  it("remaps OpenRouter's raw provider-400 wrapper", () => {
    expect(chatTurnErrorMessage(new Error("400 Provider returned error"))).toMatch(
      /free-tier model is temporarily unavailable/i,
    );
    expect(chatTurnErrorMessage(new Error("400 provider returned error"))).not.toMatch(
      /Provider returned error/i,
    );
    expect(chatTurnErrorMessage(new Error("Provider returned error"))).toMatch(
      /openrouter\.ai\/settings\/credits/i,
    );
  });

  it("remaps OpenRouter's raw ZDR / guardrail dump to a privacy hint", () => {
    const dump =
      "404 0 endpoints out of 1 requested are available matching your guardrail restrictions and data policy. We removed them for the following reasons (an endpoint may have matched multiple reasons): ZDR violation (account settings): 1 endpoint excluded; configurable at https://openrouter.ai/settings/privacy";
    const message = chatTurnErrorMessage(new Error(dump));
    expect(message).toMatch(/Zero Data Retention/i);
    expect(message).toContain("https://openrouter.ai/settings/privacy");
    expect(message).not.toMatch(/0 endpoints out of/i);
    expect(message).not.toMatch(/ZDR violation/i);
    expect(message).not.toMatch(/guardrail restrictions/i);
  });
});
