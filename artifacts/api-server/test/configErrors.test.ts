import { describe, expect, it } from "vitest";
import { isUnhandledConfigError } from "../src/lib/configErrors";

describe("isUnhandledConfigError", () => {
  it("detects missing Clerk or database env", () => {
    expect(
      isUnhandledConfigError(
        "DATABASE_URL must be set. Did you forget to provision a database?",
      ),
    ).toBe(true);
    expect(
      isUnhandledConfigError("Missing required environment variable: CLERK_SECRET_KEY"),
    ).toBe(true);
    expect(isUnhandledConfigError("Publishable key not valid.")).toBe(true);
  });

  it("does not treat LLM or generic connection failures as config errors", () => {
    expect(
      isUnhandledConfigError(
        "Anima LLM connection failed for host=example.com model=anima-chat",
      ),
    ).toBe(false);
    expect(
      isUnhandledConfigError("OpenRouter connection failed: fetch failed"),
    ).toBe(false);
    expect(isUnhandledConfigError("network timeout")).toBe(false);
  });
});
