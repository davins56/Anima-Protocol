import { describe, expect, it } from "vitest";
import { CyberworldAudio, footstepInterval, initialMuted, MUTE_STORAGE_KEY, readInitialMuted, writeMuted } from "./audio";

describe("cyberworld audio prefs", () => {
  it("stored choice wins; otherwise mute when reduced motion is preferred", () => {
    expect(initialMuted("1", false)).toBe(true);
    expect(initialMuted("0", true)).toBe(false);
    expect(initialMuted(null, true)).toBe(true);
    expect(initialMuted(null, false)).toBe(false);
    expect(initialMuted("garbage", false)).toBe(false);
  });

  it("persists mute to localStorage", () => {
    writeMuted(true);
    expect(window.localStorage.getItem(MUTE_STORAGE_KEY)).toBe("1");
    expect(readInitialMuted()).toBe(true);
    writeMuted(false);
    expect(readInitialMuted()).toBe(false);
    window.localStorage.removeItem(MUTE_STORAGE_KEY);
  });

  it("paces footsteps by speed and stays silent when idle", () => {
    expect(footstepInterval(0)).toBe(Infinity);
    expect(footstepInterval(6)).toBeCloseTo(1.9 / 6);
    expect(footstepInterval(1000)).toBe(0.18);
  });

  it("never builds an AudioContext while muted (no autoplay)", () => {
    const engine = new CyberworldAudio(true);
    engine.unlock();
    engine.step();
    engine.portal();
    expect(engine.isMuted).toBe(true);
    engine.dispose();
  });
});
