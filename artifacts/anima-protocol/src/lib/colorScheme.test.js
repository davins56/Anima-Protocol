import { afterEach, describe, expect, it } from "vitest";
import {
  applyTheme,
  initializeColorScheme,
  syncDocumentChrome,
  syncProfileColorScheme,
  THEME_CANVAS_HEX,
} from "./colorScheme";
import { saveAppearance } from "./appearanceStudio";

function themeColor() {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
}

describe("colorScheme", () => {
  afterEach(() => {
    localStorage.removeItem("app-color-scheme");
    document.documentElement.classList.remove("light", "dark");
    document.documentElement.removeAttribute("data-appearance-theme");
    document.documentElement.style.removeProperty("color-scheme");
    document.querySelector('meta[name="theme-color"]')?.remove();
    localStorage.removeItem("anima-appearance-v1");
  });

  it("defaults to dark so OS light preference cannot paint a white first screen", () => {
    const api = initializeColorScheme();
    expect(api.getTheme()).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(themeColor()).toBe(THEME_CANVAS_HEX.dark);
  });

  it("honors an explicit stored light choice from Settings", () => {
    localStorage.setItem("app-color-scheme", "light");
    initializeColorScheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(themeColor()).toBe(THEME_CANVAS_HEX.light);
  });

  it("applyTheme toggles html classes and document chrome without writing storage", () => {
    applyTheme("light");
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(localStorage.getItem("app-color-scheme")).toBeNull();
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(themeColor()).toBe(THEME_CANVAS_HEX.light);
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.classList.contains("light")).toBe(false);
    expect(localStorage.getItem("app-color-scheme")).toBeNull();
    expect(themeColor()).toBe(THEME_CANVAS_HEX.dark);
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
    expect(themeColor()).toBe(THEME_CANVAS_HEX.light);
  });

  it("syncProfileColorScheme persists the saved theme across a reload-style init", () => {
    syncProfileColorScheme("light");
    expect(localStorage.getItem("app-color-scheme")).toBe("light");
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
    initializeColorScheme();
    expect(document.documentElement.classList.contains("light")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("light");
  });

  it("syncDocumentChrome writes theme-color and color-scheme", () => {
    document.documentElement.classList.add("light");
    syncDocumentChrome("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(themeColor()).toBe(THEME_CANVAS_HEX.light);
  });
});
