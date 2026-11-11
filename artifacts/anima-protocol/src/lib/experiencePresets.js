/**
 * Device-local visual preset library. Intentionally contains NO companion identity,
 * character config, messages, memory, or authorization fields.
 * UI state is not a source of entitlement for multi-Anima creation.
 */
export const PRESET_FIELDS = Object.freeze({
  theme: ["original","nebula","celestial","emerald","eclipse","cybernetic","garden","academia","zen","synthwave","arcane","brutalist","soft-aura","living"],
  layout: ["classic","compact","immersive","dashboard"],
  radius: ["default","rounded","square"],
  scale: ["normal","large"],
  motion: ["system","reduced"],
  background: ["default","matrix","nebula","grid"],
  bubble: ["standard","rounded","terminal","outlined"],
  shell: ["solid","frosted","glass"],
  navigation: ["tabs","rail","command"],
  character: ["portrait","hologram","netnavi"],
  hud: ["minimal","battle-network","tactical"],
});
export const EXTRA_DEFAULTS = Object.freeze({
  background:"default", bubble:"standard", shell:"solid",
  navigation:"tabs", character:"portrait", hud:"minimal",
});
const PREFIX = "anima-experience-presets-v1:";
export function sanitizePreset(raw = {}) {
  const safe = {};
  for (const [field, options] of Object.entries(PRESET_FIELDS)) {
    if (options.includes(raw[field])) safe[field] = raw[field];
  }
  return safe;
}
export function storageKey(userId) {
  if (!userId || typeof userId !== "string") return null;
  return PREFIX + encodeURIComponent(userId);
}
export function loadPresets(userId, storage = globalThis.localStorage) {
  const key = storageKey(userId);
  if (!key || !storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.slice(0, 30).filter(
      row => row && typeof row.id === "string" && typeof row.name === "string"
    ).map(row => ({
      id: row.id.slice(0, 80),
      name: row.name.slice(0, 60),
      values: sanitizePreset(row.values),
    })) : [];
  } catch { return []; }
}
export function writePresets(userId, presets, storage = globalThis.localStorage) {
  const key = storageKey(userId);
  if (!key || !storage) throw new Error("Sign in to save named presets.");
  const safe = presets.slice(0, 30).map(row => ({
    id: String(row.id).slice(0, 80),
    name: String(row.name).trim().slice(0, 60),
    values: sanitizePreset(row.values),
  }));
  storage.setItem(key, JSON.stringify(safe));
  return safe;
}
export const FEATURE_MATRIX = Object.freeze([
  {name:"Global colour schemes",status:"implemented",detail:"Appearance Studio theme tokens"},
  {name:"Layout density and typography",status:"implemented",detail:"Appearance Studio settings"},
  {name:"Chat background choices",status:"implemented",detail:"ChatBackground and Settings"},
  {name:"Chat bubble variants",status:"partial",detail:"Studio simulation; existing bubble controls need wiring"},
  {name:"Frosted / glass shells",status:"partial",detail:"Studio simulation; shell control exists elsewhere"},
  {name:"Navigation patterns",status:"planned",detail:"Preview only; production navigation unchanged"},
  {name:"Character presentation",status:"planned",detail:"Preview only; no character writes"},
  {name:"NetNavi-inspired HUD",status:"planned",detail:"Preview only; battle systems unchanged"},
  {name:"Device-local named presets",status:"implemented",detail:"Per-signed-in-user browser storage"},
  {name:"Cloud-synced presets",status:"planned",detail:"Requires authenticated server storage"},
]);
