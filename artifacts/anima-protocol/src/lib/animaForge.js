// Device-local personalisation profiles. Images are stored as data URLs; limit size.
export const FORGE_KEY = "anima-forge-v1";
export const FORGE_DEFAULTS = { background: "", backgroundFit: "cover", overlay: 35, font: "default", glass: 0, navigation: "standard", bubble: "default" };
const choices = { backgroundFit: ["cover","contain"], font: ["default","serif","mono"], navigation: ["standard","floating"], bubble: ["default","soft","square"] };
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v) || 0));
export function sanitizeForge(value = {}) {
  const background = typeof value.background === "string" && /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value.background) && value.background.length < 1400000 ? value.background : "";
  return { ...FORGE_DEFAULTS, background,
    backgroundFit: choices.backgroundFit.includes(value.backgroundFit) ? value.backgroundFit : "cover",
    font: choices.font.includes(value.font) ? value.font : "default",
    navigation: choices.navigation.includes(value.navigation) ? value.navigation : "standard",
    bubble: choices.bubble.includes(value.bubble) ? value.bubble : "default",
    overlay: clamp(value.overlay,0,90), glass: clamp(value.glass,0,90) };
}
export function readForge() { try { return sanitizeForge(JSON.parse(localStorage.getItem(FORGE_KEY) || "{}")); } catch { return { ...FORGE_DEFAULTS }; } }
export function applyForge(value = readForge()) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.forgeFont = value.font;
  root.dataset.forgeNavigation = value.navigation;
  root.dataset.forgeBubble = value.bubble;
  root.style.setProperty("--forge-background", value.background ? `url("${value.background}")` : "none");
  root.style.setProperty("--forge-background-fit", value.backgroundFit);
  root.style.setProperty("--forge-overlay", String(value.overlay / 100));
  root.style.setProperty("--forge-glass", String(value.glass / 100));
  root.dataset.forgeBackground = value.background ? "enabled" : "disabled";
}
export function saveForge(patch) {
  const value = sanitizeForge({ ...readForge(), ...patch });
  localStorage.setItem(FORGE_KEY, JSON.stringify(value));
  applyForge(value);
  window.dispatchEvent(new CustomEvent("anima:forge", { detail: value }));
  return value;
}
export function exportForge() {
  const { background, ...settings } = readForge();
  return JSON.stringify({ version: 1, settings, backgroundIncluded: false }, null, 2);
}
export function importForge(text) {
  const parsed = JSON.parse(text);
  if (parsed?.version !== 1 || !parsed.settings || typeof parsed.settings !== "object") throw new Error("Invalid Anima Forge profile");
  return saveForge({ ...parsed.settings, background: "" });
}
