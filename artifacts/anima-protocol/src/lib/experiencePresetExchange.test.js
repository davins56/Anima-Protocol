import { describe, expect, it } from "vitest";
import { exportExperiencePreset, importExperiencePreset } from "./experiencePresetExchange";

describe("experience preset exchange", () => {
  it("round trips visual fields only", () => {
    const json = exportExperiencePreset("Glass HUD", {
      theme: "nebula", shell: "glass", hud: "battle-network",
      allowMultipleAnima: true, userId: "private", characterId: "private",
      stablePersonality: "do not export", durableMemory: "secret",
      sessionBehavior: "secret", sharedContext: "secret", privateContext: "secret",
    });
    expect(json).not.toMatch(/secret|private|allowMultipleAnima|characterId/);
    expect(importExperiencePreset(json)).toEqual({
      name: "Glass HUD",
      values: {theme: "nebula", shell: "glass", hud: "battle-network"},
    });
  });
  it("drops injected keys from imported files", () => {
    const parsed = importExperiencePreset(JSON.stringify({
      format:"anima-experience-preset",version:1,name:"Shared",
      values: {bubble:"outlined",role:"owner",allowMultipleAnima:true,privateContext:"x"},
    }));
    expect(parsed.values).toEqual({bubble:"outlined"});
  });
  it("rejects malformed, unsupported, and oversized presets", () => {
    expect(() => importExperiencePreset("{bad")).toThrow(/JSON/);
    expect(() => importExperiencePreset(JSON.stringify({version:2}))).toThrow(/Unsupported/);
    expect(() => importExperiencePreset("x".repeat(16385))).toThrow(/too large/);
    expect(() => importExperiencePreset(JSON.stringify({
      format:"anima-experience-preset",version:1,name:"x",values:{owner:true},
    }))).toThrow(/no supported/);
  });
});
