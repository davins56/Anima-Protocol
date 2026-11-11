import { describe, expect, it } from "vitest";
import { LatencyTracker } from "./latency";

describe("LatencyTracker", () => {
  it("measures end-of-speech to first audible audio", () => {
    const t = new LatencyTracker();
    t.markEndOfSpeech(1000);
    t.markFirstByte(1400);
    t.markFirstByte(1500); // ignored
    t.markFirstAudible(1450);
    expect(t.samples[0]).toMatchObject({ toFirstByte: 400, toFirstAudible: 450 });
    expect(t.stats()).toMatchObject({ count: 1, p50: 450, last: 450 });
  });
  it("ignores audio without a preceding end-of-speech", () => {
    const t = new LatencyTracker();
    t.markFirstByte(10);
    t.markFirstAudible(20);
    expect(t.samples).toHaveLength(0);
  });
});
