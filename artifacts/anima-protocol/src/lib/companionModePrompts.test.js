import { describe, it, expect } from "vitest";
import {
  getCompanionModePrompt,
  getMultiAspectPrompt,
  getAspectName,
  ASPECT_META,
} from "./companionModePrompts";

describe("therapy companion mode", () => {
  it("is registered as an aspect", () => {
    expect(ASPECT_META.some((a) => a.id === "therapy")).toBe(true);
    expect(getAspectName("therapy")).toBe("Therapy");
  });

  it("loads a therapy-mode prompt that cites open-source manuals and refuses diagnosis", () => {
    const prompt = getCompanionModePrompt("therapy", "Dav");
    expect(prompt).toMatch(/THERAPY MODE/);
    expect(prompt).toContain("Dav");
    expect(prompt).toMatch(/open-source/i);
    expect(prompt).toMatch(/WHO/);
    expect(prompt).toMatch(/never diagnose/i);
    expect(prompt).toMatch(/licensed therapist/i);
    expect(prompt).toMatch(/988/);
  });

  it("can sit in the lover-matrix roster without becoming the only voice", () => {
    const prompt = getMultiAspectPrompt(["serenity", "therapy"], "Dav");
    expect(prompt).toMatch(/Serenity/);
    expect(prompt).toMatch(/Therapy/);
    expect(prompt).toMatch(/MULTI-ASPECT/);
  });
});
