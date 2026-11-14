import { describe, expect, it } from "vitest";
import {
  EXTRA_DEFAULTS, FEATURE_MATRIX, loadPresets,
  sanitizePreset, storageKey, writePresets,
} from "./experiencePresets";

function memoryStorage() {
  const data = new Map();
  return {
    getItem: key => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => data.set(key, value),
  };
}

describe("visual-only experience presets", () => {
  it("whitelists visual fields and rejects arbitrary identity, memory and authorization data", () => {
    expect(sanitizePreset({
      theme: "nebula", bubble: "terminal", hud: "battle-network",
      role: "owner", allowMultipleAnima: true, characterId: "secret",
      stablePersonality: "altered", sessionBehavior: "altered",
      temporaryMemory: "secret", durableMemory: "secret",
      privateContext: "secret", sharedContext: "secret",
      navigation: "__proto__", background: "javascript:alert(1)",
    })).toEqual({theme: "nebula",bubble: "terminal",hud: "battle-network"});
  });

  it("keeps signed-in users' device presets separate", () => {
    const storage = memoryStorage();
    writePresets("user_A", [{id:"one",name:"Night",values:{theme:"eclipse",role:"owner"}}], storage);
    expect(loadPresets("user_A",storage)).toEqual([
      {id:"one",name:"Night",values:{theme:"eclipse"}}
    ]);
    expect(loadPresets("user_B",storage)).toEqual([]);
    expect(storageKey("user_A")).not.toBe(storageKey("user_B"));
    expect(() => writePresets(null,[],storage)).toThrow(/Sign in/);
  });

  it("rejects corrupt or oversized saved data gracefully", () => {
    const storage = memoryStorage();
    storage.setItem(storageKey("u1"), "{bad-json");
    expect(loadPresets("u1",storage)).toEqual([]);
    expect(writePresets("u1",Array.from({length:35},(_,i)=>({
      id:String(i),name:"x".repeat(100),values:EXTRA_DEFAULTS
    })),storage)).toHaveLength(30);
  });
  it("labels runtime styling separately from advanced production mechanics", () => {
    for (const name of ["Navigation patterns"]) {
      expect(FEATURE_MATRIX.find(feature => feature.name === name)?.status).toBe("partial");
    }
  });
  it("marks character presentation and the NetNavi HUD implemented across 3D and gameplay surfaces", () => {
    for (const name of ["Character presentation","NetNavi-inspired HUD"]) {
      const row = FEATURE_MATRIX.find(feature => feature.name === name);
      expect(row?.status).toBe("implemented");
      expect(row?.detail).not.toMatch(/pending/i);
    }
  });
});
