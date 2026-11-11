import { describe, expect, it } from "vitest";
import { bandOf, isSpawned, signalStrength, LOCK_THRESHOLD } from "./tuning";

describe("resonance tuning", () => {
  it("peaks at the node frequency and fades out of band", () => {
    expect(signalStrength(42, 42)).toBe(1);
    expect(signalStrength(42, 43)).toBeGreaterThan(LOCK_THRESHOLD);
    expect(signalStrength(42, 55)).toBeLessThan(0.01);
  });
  it("maps bands", () => {
    expect(bandOf(96.3).band).toBe("omega");
    expect(bandOf(5).band).toBe("delta");
  });
  it("respects spawn hours and is deterministic per day", () => {
    const d = new Date("2026-10-22T22:30:00");
    expect(isSpawned("n", { hours: [3] }, d)).toBe(false);
    expect(isSpawned("n", { chance: 0.5 }, d)).toBe(isSpawned("n", { chance: 0.5 }, d));
    expect(isSpawned("n", {}, d)).toBe(true);
  });
});
