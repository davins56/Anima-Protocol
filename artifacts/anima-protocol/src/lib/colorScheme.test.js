import { afterEach, describe, expect, it } from "vitest";
import { applyTheme, initializeColorScheme } from "./colorScheme";

describe("colorScheme", () => {
  afterEach(() => {
    localStorage.removeItem("app-color-scheme");
    document.documentElement.classList.remove("light", "dark");
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
});
