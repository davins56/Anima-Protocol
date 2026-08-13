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
});
