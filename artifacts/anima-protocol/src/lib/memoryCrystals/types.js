// @ts-check
/**
 * Discrete Memory Crystal milestone types.
 *
 * Crystals themselves form from conversations — this list is the attainable
 * type catalog, not a pile of fake conversation echoes.
 */

/** @typedef {{ id: string, label: string, glyph: string, color: string }} MemoryCrystalType */

/** @type {MemoryCrystalType[]} */
export const MEMORY_CRYSTAL_TYPES = [
  { id: "first_contact", label: "First Contact", glyph: "◦", color: "#34D399" },
  { id: "deep_resonance", label: "Deep Resonance", glyph: "⬟", color: "#A78BFA" },
  { id: "revelation", label: "Revelation", glyph: "◈", color: "#60A5FA" },
  { id: "emotional_peak", label: "Emotional Peak", glyph: "✦", color: "#F472B6" },
  { id: "lore_unlock", label: "Lore Unlock", glyph: "⟡", color: "#FBBF24" },
  { id: "relationship_milestone", label: "Bond Formed", glyph: "◉", color: "#FB923C" },
  { id: "shadow_confrontation", label: "Shadow Work", glyph: "⬡", color: "#F87171" },
];

export const MEMORY_CRYSTAL_TYPE_IDS = MEMORY_CRYSTAL_TYPES.map((t) => t.id);

/** @type {Record<string, MemoryCrystalType>} */
export const MILESTONE_CONFIG = Object.fromEntries(
  MEMORY_CRYSTAL_TYPES.map((t) => [t.id, t]),
);
