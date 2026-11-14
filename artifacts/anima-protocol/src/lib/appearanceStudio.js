import { syncDocumentChrome } from "./colorScheme";
// Global appearance preferences, independent of chat-specific backgrounds.
export const APPEARANCE_KEY = "anima-appearance-v1";
export const APPEARANCE_DEFAULTS = Object.freeze({ theme: "original", layout: "classic", radius: "default", scale: "normal", motion: "system" });
export const APPEARANCE_THEMES = ["original", "nebula", "celestial", "emerald", "eclipse", "cybernetic", "garden", "academia", "zen", "synthwave", "arcane", "brutalist", "soft-aura", "living"];
export const APPEARANCE_LAYOUTS = ["classic", "compact", "immersive", "dashboard"];
export function readAppearance() {
  try {
    const raw = JSON.parse(localStorage.getItem(APPEARANCE_KEY) || "{}");
    return Object.fromEntries(Object.entries(APPEARANCE_DEFAULTS).map(([key, fallback]) => [
      key, ({ theme: APPEARANCE_THEMES, layout: APPEARANCE_LAYOUTS, radius: ["default", "rounded", "square"], scale: ["normal", "large"], motion: ["system", "reduced"] }[key] || []).includes(raw[key]) ? raw[key] : fallback
    ]));
  } catch { return { ...APPEARANCE_DEFAULTS }; }
}
export function applyAppearance(value = readAppearance()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const key of Object.keys(APPEARANCE_DEFAULTS)) root.dataset["appearance" + key[0].toUpperCase() + key.slice(1)] = value[key];
  // Existing light/dark preference remains authoritative for the Original preset.
  if (value.theme !== "original") {
    root.classList.toggle("light", value.theme === "celestial");
    root.classList.toggle("dark", value.theme !== "celestial");
  }
  syncDocumentChrome(root.classList.contains("light") ? "light" : "dark");
}

export function saveAppearance(patch) {
  const value = { ...readAppearance(), ...patch };
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value));
  if (value.theme === "original") {
    const light = localStorage.getItem("app-color-scheme") === "light";
    document.documentElement.classList.toggle("light", light);
    document.documentElement.classList.toggle("dark", !light);
  }
  applyAppearance(value);
  window.dispatchEvent(new CustomEvent("anima:appearance", { detail: value }));
  return value;
}
