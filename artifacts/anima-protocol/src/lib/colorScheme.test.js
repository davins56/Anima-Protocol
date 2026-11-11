import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, initializeColorScheme, syncProfileColorScheme } from "./colorScheme";
import { saveAppearance } from "./appearanceStudio";

describe("colorScheme", () => {
  afterEach(() => {
    localStorage.removeItem("app-color-scheme");
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("data-appearance-theme");
    localStorage.removeItem("anima-appearance-v1");
  });

  it("defaults to dark so OS light preference cannot paint a white first screen", () => {
    const api = initializeColorScheme();
    expect(api.getTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("honors an explicit stored light choice from Settings", () => {
    localStorage.setItem("app-color-scheme", "light");
    initializeColorScheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("applyTheme toggles html classes", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
  });

  it("uses the profile for Original without overriding a Studio preset", () => {
    saveAppearance({ theme: "nebula" });
    syncProfileColorScheme("light");
    expect(document.documentElement.dataset.appearanceTheme).toBe("nebula");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("app-color-scheme")).toBe("light");
    saveAppearance({ theme: "original" });
    expect(document.documentElement.classList.contains("light")).toBe(true);
    initializeColorScheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
  });
});
