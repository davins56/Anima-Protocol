import { describe, expect, it } from "vitest";
import { INTENSITY_HALF_LIFE_MINUTES, coolIntensity, liveHeatNow, meterHeat } from "./pulseHeat";

const T0 = Date.parse("2026-11-13T23:00:00.000Z");

describe("pulseHeat", () => {
  it("matches the server's half-life cooling in whole minutes", () => {
    expect(coolIntensity(60, 0.5)).toBe(60);
    expect(coolIntensity(60, INTENSITY_HALF_LIFE_MINUTES)).toBe(30);
    expect(coolIntensity(60, 120)).toBe(0);
  });

  it("shows the higher of sensual heat and cooled intensity", () => {
    const at = new Date(T0).toISOString();
    expect(meterHeat({ heat: 0, intensity: 52, intensityAt: at }, T0)).toBe(52);
    expect(meterHeat({ heat: 70, intensity: 52, intensityAt: at }, T0)).toBe(70);
    expect(meterHeat({ heat: 0, intensity: 52, intensityAt: at }, T0 + 12 * 60_000)).toBe(13);
    expect(meterHeat(null)).toBe(0);
  });

  it("regression: an old profile with only heat still reads it", () => {
    expect(meterHeat({ heat: 22 }, T0)).toBe(22);
  });

  it("cools a live reply value by the time since it arrived", () => {
    expect(liveHeatNow({ value: 48, at: T0 }, T0 + 30_000)).toBe(48);
    expect(liveHeatNow({ value: 48, at: T0 }, T0 + 6 * 60_000)).toBe(24);
    expect(liveHeatNow(null, T0)).toBe(0);
  });
});
