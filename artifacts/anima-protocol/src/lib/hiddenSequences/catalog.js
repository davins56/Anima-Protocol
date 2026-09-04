// @ts-check
/**
 * Hidden Sequences catalog — voice / memory / notice triples.
 * IDs match existing Echo Key resonance recipes. Do not add recipes here.
 */

/** @typedef {"lull" | "stir" | "storm"} Weather */

export const JACK_IN_COOLDOWN_AFTER_MATCH_MS = 45 * 60 * 1000;
export const JACK_IN_COOLDOWN_SHORT_MS = 12 * 60 * 1000;
export const WEATHER_WINDOW = 12;
export const LANGUAGE_NOTE_CAP = 12;
export const HALF_AWAKE_CAP = 1;
export const EQUAL_WELL_RATIO = 2 / 3;

/** @type {Record<string, { name: string, silhouette: string, color: string, site?: string }>} */
export const VIRUS_ENTITY_MAP = {
  "Halo.Vrs": { name: "Halo.Vrs", silhouette: "halo", color: "#fde68a", site: "fallen-ruin" },
  "Shade.Vrs": { name: "Shade.Vrs", silhouette: "shade", color: "#fb7185" },
  "Static.Vrs": { name: "Static.Vrs", silhouette: "static", color: "#c4b5fd" },
  "Mettaur.Vrs": { name: "Mettaur.Vrs", silhouette: "mettaur", color: "#f87171" },
  "Aegis.Vrs": { name: "Aegis.Vrs", silhouette: "aegis", color: "#a5f3fc" },
};

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   requires: string[],
 *   voice: string,
 *   memory: string,
 *   notice: string,
 *   vessel: string,
 *   artifact: "core" | "cloth" | "markings" | "gold" | "halo" | "wings",
 * }} SequenceTriple
 */

/** @type {SequenceTriple[]} */
export const SEQUENCE_TRIPLES = [
  {
    id: "nova-pulse",
    name: "Nova Pulse",
    requires: ["pulse-base", "pulse-high", "pulse-apex"],
    voice:
      "Cathedral shot. Three pulse barrels remember they were one throat. Speech tightens into a single bright line, then releases.",
    memory: "The first time three pulses stacked and the lattice rang like a nave.",
    notice: "She names Nova Pulse as if tasting metal light — not as a menu item.",
    vessel: "Chest core flares hotter purple-white. Wet specular on the sternum.",
    artifact: "core",
  },
  {
    id: "life-veil",
    name: "Life Veil",
    requires: ["phantom-base", "phantom-high", "phantom-apex"],
    voice:
      "Horizon cut. Soft consonants. She speaks as if a blade passed and the air has not closed.",
    memory: "Three phantom blades becoming one veil — protection that looks like leaving.",
    notice: "Life Veil is named like a garment she almost remembers wearing.",
    vessel: "Cloth transmission rises; the white robe reads wetter, more refractive.",
    artifact: "cloth",
  },
  {
    id: "chain-bloom",
    name: "Chain Bloom",
    requires: ["seed-base", "seed-high", "seed-apex"],
    voice:
      "Seeds daisy-chain. Sentences link. She does not stack topics; she lets one image bloom into the next.",
    memory: "A field of seeds finding each other across an enemy area.",
    notice: "Chain Bloom is named as growth, not explosion.",
    vessel: "Marking layer (変) and sash facets pick up grove-green in the crystal.",
    artifact: "markings",
  },
  {
    id: "star-best",
    name: "Best Link",
    requires: ["plasmagun-base", "heatupper-base", "iceneedle-base"],
    voice: "Lock. Plasma, upper, and needle spoken as one grip. Fewer words. More aim.",
    memory: "Star Force memory — three unlike keys that still chose each other.",
    notice: "Best Link is named as a held hand, not a combo list.",
    vessel: "Gold armbands brighten; wet light runs their edges.",
    artifact: "gold",
  },
  {
    id: "noise-tribe",
    name: "Tribe Noise",
    requires: ["noiseflare-base", "tribeon-base", "stellarlock-base"],
    voice:
      "Noise Change and Tribe On ride a lock. Rhythm in the line. A second pulse under the words.",
    memory: "A crowd-frequency that was never a crowd — one Anima holding three rides.",
    notice: "Tribe Noise is named like a frequency she can still hum.",
    vessel: "Halo shards pick up volt-edge; orbiting motes thicken.",
    artifact: "halo",
  },
  {
    id: "star-triad",
    name: "Star Triad",
    requires: [],
    voice:
      "Satellite finisher. Distant, precise, a little cold until she chooses warmth.",
    memory: "Three Star keys locking into one overhead cut.",
    notice: "Star Triad is named as a sky she has already stood under.",
    vessel: "Wings gain a third iridescent pass (pink at the tips). Expression emission up.",
    artifact: "wings",
  },
];

export const SEQUENCE_BY_ID = Object.fromEntries(
  SEQUENCE_TRIPLES.map((s) => [s.id, s]),
);

export const SEQUENCE_NAME_RE =
  /nova pulse|life veil|chain bloom|best link|tribe noise|star triad/i;

export function sequenceByFiredId(id) {
  if (!id) return null;
  return SEQUENCE_BY_ID[id] || null;
}

export const HALF_AWAKE_GLITCH =
  "A Sequence is half-awake ({name}). Do not teach it. One short sensory glitch is enough — a name, a taste of light, then return to the steward.";
