import { describe, expect, it } from "vitest";
import { mapImageEditError } from "../src/routes/openai/functions";

describe("mapImageEditError", () => {
  it("maps OpenAI 429 rate limits to a friendly rate_limit error", () => {
    const mapped = mapImageEditError({ status: 429, message: "Rate limit reached" });
    expect(mapped.status).toBe(429);
    expect(mapped.code).toBe("rate_limit");
  });

  it("maps insufficient_quota to a rate_limit error", () => {
    const mapped = mapImageEditError({ status: 429, code: "insufficient_quota", message: "You exceeded your quota" });
    expect(mapped.status).toBe(429);
    expect(mapped.code).toBe("rate_limit");
  });

  it("maps moderation/content-policy rejections to content_policy", () => {
    const mapped = mapImageEditError({
      status: 400,
      code: "moderation_blocked",
      message: "Your request was rejected by the safety system",
    });
    expect(mapped.status).toBe(400);
    expect(mapped.code).toBe("content_policy");
  });

  it("detects content policy from the message even without a code", () => {
    const mapped = mapImageEditError({ status: 400, message: "This request violates our content policy." });
    expect(mapped.code).toBe("content_policy");
  });

  it("falls back to server_error and preserves the upstream status", () => {
    const mapped = mapImageEditError({ status: 503, message: "upstream unavailable" });
    expect(mapped.status).toBe(503);
    expect(mapped.code).toBe("server_error");
    expect(mapped.error).toBe("upstream unavailable");
  });

  it("defaults to 500 for unknown errors with no status", () => {
    const mapped = mapImageEditError(new Error("boom"));
    expect(mapped.status).toBe(500);
    expect(mapped.code).toBe("server_error");
    expect(mapped.error).toBe("boom");
  });

  it("handles string errors safely", () => {
    const mapped = mapImageEditError("something broke");
    expect(mapped.status).toBe(500);
    expect(mapped.error).toBe("something broke");
  });
});
