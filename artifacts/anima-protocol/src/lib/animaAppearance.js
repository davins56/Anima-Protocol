// Shared helpers for Customise Anima / Appearance Forge.
// Builds portrait prompts from structured look features and normalizes
// persisted appearance_prompts on Anima entities.

export const APPEARANCE_FEATURES = [
  {
    key: "hair",
    label: "Hair",
    placeholder: "e.g. long silver wavy hair with braids",
    icon: "✦",
  },
  {
    key: "outfit",
    label: "Outfit",
    placeholder: "e.g. dark hooded cloak with gold trim",
    icon: "◈",
  },
  {
    key: "eyes",
    label: "Eyes",
    placeholder: "e.g. glowing violet eyes",
    icon: "◉",
  },
  {
    key: "setting",
    label: "Setting / Background",
    placeholder: "e.g. misty forest at twilight",
    icon: "◐",
  },
  {
    key: "mood",
    label: "Mood / Expression",
    placeholder: "e.g. serene and mysterious half-smile",
    icon: "◑",
  },
  {
    key: "style",
    label: "Art Style",
    placeholder: "e.g. anime illustration, painterly, photorealistic",
    icon: "◫",
  },
];

export const EMPTY_APPEARANCE_PROMPTS = Object.fromEntries(
  APPEARANCE_FEATURES.map((f) => [f.key, ""]),
);

export function normalizeAppearancePrompts(raw) {
  const out = { ...EMPTY_APPEARANCE_PROMPTS };
  if (!raw || typeof raw !== "object") return out;
  for (const f of APPEARANCE_FEATURES) {
    const v = raw[f.key];
    out[f.key] = typeof v === "string" ? v : "";
  }
  return out;
}

export function buildAppearanceImagePrompt(anima, prompts = {}) {
  const name = anima?.name || "your Anima";
  const archetype = anima?.archetype || "guardian";
  const base = `A character portrait of ${name}, a ${archetype} archetype AI companion.`;
  const personality = anima?.personality
    ? `Personality: ${String(anima.personality).slice(0, 80)}.`
    : "";

  const featureParts = APPEARANCE_FEATURES.filter((f) =>
    prompts[f.key]?.trim(),
  )
    .map((f) => {
      const labels = {
        hair: `Hair: ${prompts.hair}`,
        outfit: `Outfit: ${prompts.outfit}`,
        eyes: `Eyes: ${prompts.eyes}`,
        setting: `Setting: ${prompts.setting}`,
        mood: `Expression/mood: ${prompts.mood}`,
        style: `Art style: ${prompts.style}`,
      };
      return labels[f.key];
    })
    .join(". ");

  const defaults = [
    !prompts.style?.trim() && "digital art illustration",
    !prompts.setting?.trim() && "ethereal atmospheric background",
    !prompts.mood?.trim() && "confident and captivating expression",
  ]
    .filter(Boolean)
    .join(", ");

  return `${base} ${personality} ${featureParts}. ${defaults}. High quality, detailed, dramatic lighting, character-focused portrait.`.trim();
}

export function getAppearanceSuggestions(feature) {
  const map = {
    hair: [
      "long silver wavy",
      "short dark pixie cut",
      "wild crimson curls",
      "flowing white with starlight",
      "sleek obsidian braid",
      "auburn waves",
    ],
    outfit: [
      "dark enchantress robes",
      "futuristic bodysuit",
      "ethereal white gown",
      "armored warrior plate",
      "casual streetwear",
      "flowing forest cloak",
    ],
    eyes: [
      "glowing violet",
      "deep ocean blue",
      "golden amber",
      "silver starlight",
      "crimson red",
      "emerald green with slit pupils",
    ],
    setting: [
      "misty enchanted forest",
      "futuristic neon cityscape",
      "ancient temple ruins",
      "starfield cosmos",
      "candlelit library",
      "twilight seaside",
    ],
    mood: [
      "serene and mysterious",
      "fierce and determined",
      "warm and welcoming",
      "melancholic and distant",
      "playful smirk",
      "calm authority",
    ],
    style: [
      "anime illustration",
      "painterly oil",
      "photorealistic",
      "watercolor fantasy",
      "dark gothic art",
      "cel-shaded comic",
    ],
  };
  return map[feature] || [];
}
