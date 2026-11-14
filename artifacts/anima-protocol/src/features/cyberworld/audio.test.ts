import { describe, expect, it, vi } from "vitest";
import { audioContextCtor, CyberworldAudio, footstepInterval, initialMuted, MUTE_STORAGE_KEY, readInitialMuted, writeMuted } from "./audio";

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

  it("feature-detects AudioContext, falls back to webkitAudioContext, else null", () => {
    class A {}
    class W {}
    expect(audioContextCtor({ AudioContext: A, webkitAudioContext: W })).toBe(A);
    expect(audioContextCtor({ webkitAudioContext: W })).toBe(W);
    expect(audioContextCtor({})).toBeNull();
    expect(audioContextCtor(undefined)).toBeNull();
    expect(audioContextCtor({ AudioContext: {} })).toBeNull();
  });

  it("a throwing AudioContext only disables sound", () => {
    const orig = (window as unknown as { AudioContext?: unknown }).AudioContext;
    (window as unknown as { AudioContext?: unknown }).AudioContext = class {
      constructor() {
        throw new Error("not allowed");
      }
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const engine = new CyberworldAudio(false);
      expect(() => engine.unlock()).not.toThrow();
      expect(() => engine.blip()).not.toThrow();
    } finally {
      warn.mockRestore();
      (window as unknown as { AudioContext?: unknown }).AudioContext = orig;
    }
  });
});
