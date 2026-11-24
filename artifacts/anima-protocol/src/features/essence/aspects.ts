/** The six facets from the Base44 prototype, with where each one's data lives today. */
export type AspectKey = "memory" | "dream" | "emotion" | "intuition" | "reflection" | "aspiration";

export type AspectDef = {
  key: AspectKey;
  name: string;
  line: string;
  /** Existing in-app view this aspect opens, when there is one. */
  link?: (characterId: string) => string;
  /** Where the count comes from. 'pending' = waiting on Backend Data's Essence routes. */
  source: "memory_health" | "dream_journal" | "local_reflections" | "pending";
};

export const ASPECTS: AspectDef[] = [
  {
    key: "memory",
    name: "Memory",
    line: "Echoes of what was",
    link: (id) => `/what-she-remembers/${encodeURIComponent(id)}`,
    source: "memory_health",
  },
  {
    key: "dream",
    name: "Dream",
    line: "Visions from the liminal depths of sleep",
    link: (id) => `/dreams/${encodeURIComponent(id)}`,
    source: "dream_journal",
  },
  { key: "emotion", name: "Emotion", line: "The tides of feeling", source: "pending" },
  { key: "intuition", name: "Intuition", line: "Knowing that arrives before reason", source: "pending" },
  { key: "reflection", name: "Reflection", line: "The mirror turned inward", source: "local_reflections" },
  { key: "aspiration", name: "Aspiration", line: "The pull toward what the self might become", source: "pending" },
];
