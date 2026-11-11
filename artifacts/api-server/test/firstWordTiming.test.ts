import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatPipelineTelemetry, chunkHasWord } from "../src/lib/chatTelemetry";

afterEach(() => vi.useRealTimers());

describe("first-word timing", () => {
  it("only counts chunks with a letter or digit", () => {
    expect(chunkHasWord("   ")).toBe(false);
    expect(chunkHasWord("*")).toBe(false);
    expect(chunkHasWord(" Hi")).toBe(true);
  });

  it("measures from request start, not telemetry construction", () => {
    vi.useFakeTimers();
    vi.setSystemTime(10_000);
    const t = new ChatPipelineTelemetry({ turnId: "t", sessionId: "s", mode: "solo", requestStartedAtMs: 9_000 });
    expect(t.firstWordMs()).toBeNull();
    vi.setSystemTime(10_500);
    t.markVisibleDelta("  ");
    expect(t.firstWordMs()).toBeNull();
    vi.setSystemTime(11_200);
    t.markVisibleDelta("Hello");
    vi.setSystemTime(12_000);
    t.markVisibleDelta(" again");
    expect(t.firstWordMs()).toBe(2_200);
  });
});
