/**
 * Loot tables: what data you can find, where and when. Each entry is data:
 * biomes it appears in ("any" = everywhere), rarity, optional time / weather
 * / season conditions, and lore shown by Inspect. Add finds by adding rows.
 */
import type { BiomeId } from "./biomes";
import type { Season, TimeOfDay, Weather } from "./region";
import { weightedIndex } from "./rng";

export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type LootKind = "fragment" | "item" | "lore";

export type LootDef = {
  id: string;
  name: string;
  kind: LootKind;
  rarity: Rarity;
  biomes: readonly BiomeId[] | "any";
  time?: readonly TimeOfDay[];
  weather?: readonly Weather[];
  season?: readonly Season[];
  lore: string;
};

export const RARITY: Record<Rarity, { weight: number; color: string; label: string }> = {
  common: { weight: 60, color: "#94A3B8", label: "Common" },
  uncommon: { weight: 25, color: "#34D399", label: "Uncommon" },
  rare: { weight: 10, color: "#38BDF8", label: "Rare" },
  epic: { weight: 4, color: "#A78BFA", label: "Epic" },
  legendary: { weight: 1, color: "#FACC15", label: "Legendary" },
};

/** Conditional finds are boosted when their condition is met (they are only eligible then). */
export const CONDITION_BOOST = 2.5;

export const LOOT: readonly LootDef[] = [
  // anywhere
  { id: "stray-packet", name: "Stray Packet", kind: "fragment", rarity: "common", biomes: "any", lore: "A packet that never reached its destination. It still remembers the address." },
  { id: "bit-dust", name: "Bit Dust", kind: "fragment", rarity: "common", biomes: "any", lore: "Fine residue of deleted files. Navis use it to patch small tears." },
  { id: "echo-shard", name: "Echo Shard", kind: "fragment", rarity: "uncommon", biomes: "any", lore: "A splinter of a conversation that resonated so strongly it crystallised." },
  { id: "moon-cache", name: "Moonlit Cache", kind: "item", rarity: "rare", biomes: "any", time: ["night"], lore: "Only decompresses under night-cycle clocks. Smells faintly of old servers." },
  { id: "dawn-key", name: "Dawn Handshake", kind: "item", rarity: "epic", biomes: "any", time: ["dawn"], lore: "The first handshake of the day, kept as a key. Opens things that were closed overnight." },
  { id: "storm-core", name: "Storm Core", kind: "item", rarity: "legendary", biomes: "any", weather: ["storm"], lore: "Lightning in a bottle — literally. A surge captured mid-strike." },
  { id: "rain-glyph", name: "Rain Glyph", kind: "lore", rarity: "rare", biomes: "any", weather: ["rain"], lore: "Patterns written by raindrops on the firewall. Each one is unique." },
  { id: "snow-buffer", name: "Snow Buffer", kind: "fragment", rarity: "uncommon", biomes: "any", weather: ["snow"], season: ["winter"], lore: "Quiet, white noise in solid form. Muffles any signal it touches." },
  // urban
  { id: "ad-sprite", name: "Rogue Ad Sprite", kind: "fragment", rarity: "common", biomes: ["urban"], lore: "An advertisement that escaped its banner and now wanders the grid." },
  { id: "traffic-log", name: "Traffic Log", kind: "lore", rarity: "uncommon", biomes: ["urban"], lore: "A million commutes in one file. Somewhere in it, a route home." },
  { id: "neon-sigil", name: "Neon Sigil", kind: "item", rarity: "rare", biomes: ["urban"], time: ["dusk", "night"], lore: "Glows brighter as the city lights come on." },
  { id: "skyline-root", name: "Skyline Root Key", kind: "item", rarity: "epic", biomes: ["urban"], lore: "Root access to a tower that only exists in the net." },
  // coastal
  { id: "tide-packet", name: "Tide Packet", kind: "fragment", rarity: "common", biomes: ["coastal"], lore: "Washed in on the data tide; it hums with the rhythm of waves." },
  { id: "shell-script", name: "Shell Script", kind: "item", rarity: "uncommon", biomes: ["coastal"], lore: "A tiny program coiled like a seashell. Hold it up and you hear the network." },
  { id: "pearl-hash", name: "Pearl Hash", kind: "item", rarity: "rare", biomes: ["coastal"], lore: "A perfectly round checksum, layered over years." },
  { id: "abyss-index", name: "Abyssal Index", kind: "lore", rarity: "epic", biomes: ["coastal"], time: ["night"], lore: "A directory of things that sank and were never re-indexed." },
  // forest
  { id: "seed-byte", name: "Seed Byte", kind: "fragment", rarity: "common", biomes: ["forest"], lore: "Plant it in an empty directory and something will grow." },
  { id: "moss-cache", name: "Moss Cache", kind: "fragment", rarity: "uncommon", biomes: ["forest"], weather: ["rain", "fog"], lore: "Soft, green and damp. Thrives in wet weather cycles." },
  { id: "heartwood", name: "Heartwood Codex", kind: "lore", rarity: "rare", biomes: ["forest"], lore: "Rings of version history, one per year the tree survived." },
  { id: "elder-root", name: "Elder Root", kind: "item", rarity: "epic", biomes: ["forest"], season: ["autumn"], lore: "Surfaces only when the mesh sheds its leaves." },
  // desert
  { id: "sand-bit", name: "Sand Bit", kind: "fragment", rarity: "common", biomes: ["desert"], lore: "Each grain a single bit. Dunes of them shift with the wind." },
  { id: "mirage-file", name: "Mirage File", kind: "lore", rarity: "uncommon", biomes: ["desert"], time: ["day"], lore: "Looks real at noon. Opens to nothing — or to everything." },
  { id: "glass-shard", name: "Fulgurite Shard", kind: "item", rarity: "rare", biomes: ["desert"], lore: "Sand fused by a power surge into a branching glass circuit." },
  { id: "buried-archive", name: "Buried Archive", kind: "lore", rarity: "epic", biomes: ["desert"], lore: "An entire civilisation's backups, sealed under the dunes." },
  // mountain
  { id: "thin-signal", name: "Thin Signal", kind: "fragment", rarity: "common", biomes: ["mountain"], lore: "Faint but clean. Carries farther than you'd think." },
  { id: "relay-crystal", name: "Relay Crystal", kind: "item", rarity: "uncommon", biomes: ["mountain"], lore: "Amplifies whatever passes through it. Hikers' Navis collect them." },
  { id: "summit-echo", name: "Summit Echo", kind: "lore", rarity: "rare", biomes: ["mountain"], time: ["dawn"], lore: "Shout from the peak and the net answers back — this is the answer." },
  { id: "avalanche-dump", name: "Avalanche Dump", kind: "item", rarity: "epic", biomes: ["mountain"], weather: ["snow"], lore: "A crash dump the size of a mountainside." },
  // polar
  { id: "frost-bit", name: "Frost Bit", kind: "fragment", rarity: "common", biomes: ["polar"], lore: "Bit-rot can't touch it; it's frozen solid." },
  { id: "cold-backup", name: "Cold Backup", kind: "item", rarity: "uncommon", biomes: ["polar"], lore: "Somebody's whole life, on ice, waiting to be restored." },
  { id: "aurora-core", name: "Aurora Core", kind: "item", rarity: "legendary", biomes: ["polar"], time: ["night"], lore: "The aurora, compressed. It still ripples when you look away." },
  { id: "permafrost-log", name: "Permafrost Log", kind: "lore", rarity: "rare", biomes: ["polar"], lore: "Entries older than the network itself. Some predate electricity." },
];

export const LOOT_BY_ID: Record<string, LootDef> = Object.fromEntries(LOOT.map((l) => [l.id, l]));

export type LootConditions = { biome: BiomeId; timeOfDay: TimeOfDay; weather: Weather; season: Season };

export function isConditional(def: LootDef): boolean {
  return !!(def.time || def.weather || def.season);
}

export function isEligible(def: LootDef, c: LootConditions): boolean {
  if (def.biomes !== "any" && !def.biomes.includes(c.biome)) return false;
  if (def.time && !def.time.includes(c.timeOfDay)) return false;
  if (def.weather && !def.weather.includes(c.weather)) return false;
  if (def.season && !def.season.includes(c.season)) return false;
  return true;
}

export function eligibleLoot(c: LootConditions, table: readonly LootDef[] = LOOT): LootDef[] {
  return table.filter((d) => isEligible(d, c));
}

/** Weight of a def: rarity weight, boosted for biome-native and condition-gated finds. */
export function lootWeight(def: LootDef): number {
  let w = RARITY[def.rarity].weight;
  if (def.biomes !== "any") w *= 1.6;
  if (isConditional(def)) w *= CONDITION_BOOST;
  return w;
}

export function rollLoot(rng: () => number, c: LootConditions, table: readonly LootDef[] = LOOT): LootDef | null {
  const pool = eligibleLoot(c, table);
  const i = weightedIndex(pool.map(lootWeight), rng());
  return i < 0 ? null : pool[i];
}
