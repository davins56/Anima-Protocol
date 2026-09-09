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

  it("remaps raw generic HTTP 400 and backend request failure errors to user-friendly messages", () => {
    expect(chatTurnErrorMessage(new Error("backend request failed with error 400"))).toBe(
      "The companion service encountered an issue (HTTP 400). Please try again in a moment.",
    );
    expect(chatTurnErrorMessage(new Error("Request failed with status code 400"))).toBe(
      "The companion service encountered an issue (HTTP 400). Please try again in a moment.",
    );
    expect(chatTurnErrorMessage(new Error("API error: 400"))).toBe(
      "The companion service encountered an issue (HTTP 400). Please try again in a moment.",
    );
    expect(chatTurnErrorMessage(new Error("HTTP 400"))).toBe(
      "The companion service encountered an issue (HTTP 400). Please try again in a moment.",
    );
  });

  it("remaps generic HTTP status codes to polite error messages", () => {
    expect(chatTurnErrorMessage(new Error("API error: 500"))).toBe(
      "The companion service encountered an issue. Please try again in a moment.",
    );
  });

  it("keeps Workers AI / DeepSeek failures visible instead of a generic toast", () => {
    expect(
      chatTurnErrorMessage(
        new Error("DeepSeek on Workers AI failed: model overloaded"),
      ),
    ).toMatch(/DeepSeek on Workers AI failed: model overloaded/);
  });

  it("remaps Workers AI error 4006 to the free-quota hint", () => {
    expect(
      chatTurnErrorMessage(
        new Error(
          "4006: you have used up your daily free allocation of 10,000 neurons, please upgrade to Cloudflare's Workers Paid plan if",
        ),
      ),
    ).toBe(
      "Workers AI daily free quota exhausted — enable Workers Paid or temporarily allow OpenRouter failover",
    );
    expect(
      chatTurnErrorMessage(
        new Error(
          "DeepSeek on Workers AI failed: 4006: you have used up your daily free allocation of 10,000 neurons",
        ),
      ),
    ).toMatch(/Workers AI daily free quota exhausted/);
  });

  it("remaps unauthorized and missing-session send failures", () => {
    expect(chatTurnErrorMessage(new Error("Unauthorized"))).toMatch(/Not signed in/);
    expect(chatTurnErrorMessage(new Error("Session not found"))).toMatch(
      /conversation could not be found/i,
    );
  });
});
