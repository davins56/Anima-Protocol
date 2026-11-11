/**
 * Device-local UI preference surface. Presentation only, never used for
 * authorization, character identity, prompt context, or memory persistence.
 */
import { EXTRA_DEFAULTS, sanitizePreset, storageKey } from "./experiencePresets";

export const EXTRAS_EVENT = "anima:experience-extras";
const suffix = ":active-visuals";

export function activeExtrasKey(userId) {
  const key = storageKey(userId);
  return key ? key + suffix : null;
}

export function readActiveExtras(userId, storage = globalThis.localStorage) {
  const key = activeExtrasKey(userId);
  if (!key || !storage) return { ...EXTRA_DEFAULTS };
  try {
    const data = JSON.parse(storage.getItem(key) || "{}");
    const safe = sanitizePreset(data);
    return Object.fromEntries(Object.entries(EXTRA_DEFAULTS).map(([k,v]) => [k,safe[k] || v]));
  } catch { return { ...EXTRA_DEFAULTS }; }
}

export function applyActiveExtras(userId, doc = globalThis.document, storage = globalThis.localStorage) {
  if (!doc?.documentElement) return;
  const value = readActiveExtras(userId, storage);
  const root = doc.documentElement;
  for (const [name, choice] of Object.entries(value)) {
    root.dataset["experience" + name[0].toUpperCase() + name.slice(1)] = choice;
  }
  return value;
}

export function saveActiveExtras(userId, values, storage = globalThis.localStorage) {
  const key = activeExtrasKey(userId);
  if (!key || !storage) throw new Error("Sign in to apply experience settings.");
  const safe = sanitizePreset(values);
  const extras = Object.fromEntries(Object.keys(EXTRA_DEFAULTS).map(
    name => [name, safe[name] || EXTRA_DEFAULTS[name]]
  ));
  storage.setItem(key, JSON.stringify(extras));
  if (typeof document !== "undefined") applyActiveExtras(userId, document, storage);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(EXTRAS_EVENT,{detail:extras}));
  return extras;
}
