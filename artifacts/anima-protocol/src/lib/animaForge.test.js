import { beforeEach, describe, expect, it } from "vitest";
import { readForge, saveForge, exportForge } from "./animaForge";

/** Anima Forge glass: the slider exists, it clamps, and it reaches the DOM. */

beforeEach(() => {
  localStorage.clear();
  const root = document.documentElement;
  root.removeAttribute("data-forge-glass");
  root.style.removeProperty("--forge-glass-blur");
  root.style.removeProperty("--forge-glass-solid");
});

describe("animaForge glass", () => {
  it("defaults to 0 and clamps to the 0-90 range", () => {
    expect(readForge().glass).toBe(0);
    expect(saveForge({ glass: 200 }).glass).toBe(90);
    expect(saveForge({ glass: -20 }).glass).toBe(0);
    expect(saveForge({ glass: "55" }).glass).toBe(55);
  });

  it("marks the root and publishes blur + shell opacity when glass is on", () => {
    const value = saveForge({ glass: 45 });
    const root = document.documentElement;

    expect(value.glass).toBe(45);
    expect(root.dataset.forgeGlass).toBe("on");
    // 45/90 of the range maps to a 3px blur.
    expect(root.style.getPropertyValue("--forge-glass-blur")).toBe("3px");
    expect(root.style.getPropertyValue("--forge-glass-solid")).toBe(
      `${Math.round(100 - 45 * 0.6)}%`,
    );
  });

  it("turns the effect off again at zero", () => {
    saveForge({ glass: 60 });
    expect(document.documentElement.dataset.forgeGlass).toBe("on");

    saveForge({ glass: 0 });
    expect(document.documentElement.dataset.forgeGlass).toBe("off");
    expect(document.documentElement.style.getPropertyValue("--forge-glass-blur")).toBe(
      "0px",
    );
  });

  it("keeps glass in exported profiles now that a control sets it", () => {
    saveForge({ glass: 30 });
    const profile = JSON.parse(exportForge());
    expect(profile.settings.glass).toBe(30);
    expect(profile.backgroundIncluded).toBe(false);
  });
});
