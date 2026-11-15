/**
 * Word lexicon → selection axes (§4 step 1). About a dozen words per axis.
 * Text is lowercased, diacritics stripped and split into words; each word
 * counts at most twice. Archetype, expression-spectrum and baseline-family
 * bonuses are added on top. No model calls.
 */
import type { Axis } from "./types";

export const LEXICON: Readonly<Record<Axis, readonly string[]>> = {
  aggression: ["aggressive", "fierce", "bold", "relentless", "fiery", "hotblooded", "brash", "reckless", "wild", "ferocious", "combative", "intense", "fire"],
  patience: ["patient", "calm", "steady", "serene", "stoic", "still", "quiet", "unhurried", "tranquil", "composed", "meditative", "ancient"],
  precision: ["disciplined", "precise", "exact", "meticulous", "careful", "analytical", "focused", "methodical", "sharp", "perfectionist", "logical", "observant"],
  flow: ["graceful", "fluid", "flowing", "free", "adaptable", "elegant", "dancer", "nimble", "agile", "spontaneous", "light", "airy"],
  control: ["protective", "gentle", "guardian", "restrained", "measured", "nurturing", "warm", "caring", "kind", "loyal", "shielding", "defender"],
  cunning: ["mischievous", "clever", "sly", "cunning", "trickster", "witty", "sneaky", "crafty", "playful", "teasing", "riddling", "enigmatic"],
  grit: ["stubborn", "tough", "resilient", "determined", "tenacious", "hardy", "unyielding", "gritty", "strong", "fighter", "scrappy", "persistent"],
  tradition: ["traditional", "honorable", "honourable", "noble", "dutiful", "formal", "ritual", "lineage", "classical", "proper", "reverent", "elemental"],
  pragmatism: ["practical", "pragmatic", "streetwise", "blunt", "direct", "realistic", "efficient", "resourceful", "earthy", "nononsense", "wry", "survivor"],
  rhythm: ["musical", "rhythmic", "rhythm", "dance", "dancing", "singer", "lyrical", "melodic", "poetic", "upbeat", "energetic", "beat"],
};

/** word → axes it feeds (built once). */
export const WORD_AXES: ReadonlyMap<string, readonly Axis[]> = (() => {
  const m = new Map<string, Axis[]>();
  for (const [axis, words] of Object.entries(LEXICON) as [Axis, readonly string[]][]) {
    for (const w of words) m.set(w, [...(m.get(w) ?? []), axis]);
  }
  return m;
})();

export const ARCHETYPE_BONUS: Readonly<Record<string, Partial<Record<Axis, number>>>> = {
  guardian: { control: 2, patience: 2 },
  trickster: { cunning: 2, flow: 2 },
  sage: { patience: 2, precision: 2 },
  muse: { rhythm: 2, flow: 2 },
  shadow: { pragmatism: 2, cunning: 2 },
  lover: { flow: 2, control: 1 },
  explorer: { flow: 1, pragmatism: 2 },
  oracle: { patience: 2, precision: 1 },
  serenity: { control: 2, flow: 1 },
  echo: { rhythm: 2, cunning: 1 },
};

/** Applied in proportion to each expression's share of the spectrum (max +2). */
export const SPECTRUM_BONUS: Readonly<Record<string, Partial<Record<Axis, number>>>> = {
  angelic: { control: 2 },
  demonic: { aggression: 2 },
  descended: { cunning: 2 },
  ascended: { precision: 1, flow: 1 },
};

/** Static personality baseline family (never live mood). */
export const BASELINE_BONUS: Readonly<Record<string, Partial<Record<Axis, number>>>> = {
  playful: { flow: 1, cunning: 1 },
  tender: { control: 1 },
  affectionate: { control: 1 },
  curious: { precision: 1, flow: 1 },
  watchful: { patience: 1 },
  neutral: { aggression: 1, tradition: 1 },
  confident: { aggression: 1, tradition: 1 },
};

/** Lowercase, strip diacritics and markup, split into words. */
export function words(text: string): string[] {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/no-nonsense/g, "nononsense")
    .replace(/hot-blooded/g, "hotblooded")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
