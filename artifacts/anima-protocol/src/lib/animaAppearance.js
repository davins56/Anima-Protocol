// Shared helpers for Customise Anima / Appearance Forge.
// Builds portrait prompts from structured look features and normalizes
// persisted appearance_prompts on Anima entities.

export const APPEARANCE_FEATURES = [
  {
    key: "skin",
    label: "Skin Colour",
    placeholder: "e.g. warm medium brown, porcelain fair, deep ebony",
    icon: "◎",
  },
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

/** Rich descriptors so image models don't collapse vague skin labels to a default. */
const SKIN_TONE_EXPANSIONS = {
  "porcelain fair":
    "very pale porcelain-fair skin with cool pink undertones; light complexion on face, neck, and hands (not tan, not brown)",
  "light olive":
    "light olive skin with soft green-gold undertones; lightly tanned Mediterranean complexion (not pale porcelain, not deep brown)",
  "warm peach":
    "warm peach / light beige skin with golden-pink undertones; fair-to-light complexion with a sunlit glow",
  "golden tan":
    "golden tan skin with warm yellow-gold undertones; clearly tanned medium-light complexion (not pale, not deep ebony)",
  "warm medium brown":
    "warm medium-brown skin with rich golden-bronze undertones; clearly brown complexion on face, neck, and hands (not pale, not light tan)",
  "deep ebony":
    "very deep ebony / dark brown skin with cool undertones and high melanin; unmistakably dark complexion on face, neck, and hands (not light, not tan, not medium-brown)",
};

/**
 * Expand a short skin label into an unambiguous visual description.
 * Custom free-text is kept and reinforced with face/neck/hands coverage.
 */
export function expandSkinToneDescriptor(raw) {
  const skin = typeof raw === "string" ? raw.trim() : "";
  if (!skin) return "";
  const key = skin.toLowerCase();
  const expanded = SKIN_TONE_EXPANSIONS[key];
  if (expanded) return expanded;
  return `${skin} skin tone — match this complexion exactly on face, neck, and hands; do not default to a different skin colour`;
}

export function normalizeAppearancePrompts(raw) {
  const out = { ...EMPTY_APPEARANCE_PROMPTS };
  if (!raw || typeof raw !== "object") return out;
  for (const f of APPEARANCE_FEATURES) {
    const v = raw[f.key];
    out[f.key] = typeof v === "string" ? v : "";
  }
  return out;
}

/**
 * @param {object} anima
 * @param {Record<string, string>} prompts
 * @param {{ useReference?: boolean }} [opts]
 *   useReference — prompt is for image-edit from an uploaded reference photo
 */
export function buildAppearanceImagePrompt(anima, prompts = {}, opts = {}) {
  const name = anima?.name || "your Anima";
  const archetype = anima?.archetype || "guardian";
  const skinRaw = typeof prompts.skin === "string" ? prompts.skin.trim() : "";
  const skinDesc = expandSkinToneDescriptor(skinRaw);
  const useReference = Boolean(opts.useReference);

  // Hard constraint block first — image models overweight the opening tokens.
  const skinBlock = skinDesc
    ? [
        `HARD REQUIREMENT — SKIN TONE: ${skinDesc}.`,
        "The skin colour is the most important visual trait; render it accurately and consistently.",
        "Do not lighten, darken, or ignore this complexion.",
      ].join(" ")
    : useReference
      ? "Keep the reference photo's natural skin tone unless a skin colour is specified above."
      : "";

  const base = useReference
    ? [
        `Transform the attached reference photo into a character portrait of ${name}, a ${archetype} archetype AI companion.`,
        "Preserve the person's facial identity, bone structure, and overall likeness from the reference.",
        "Apply the appearance customizations below (hair, outfit, eyes, style, etc.) on top of that likeness.",
      ].join(" ")
    : `Create a single character portrait of ${name}, a ${archetype} archetype AI companion.`;
  const personality = anima?.personality
    ? `Personality vibe (expression only, do not change skin): ${String(anima.personality).slice(0, 60)}.`
    : "";

  const featureParts = APPEARANCE_FEATURES.filter(
    (f) => f.key !== "skin" && prompts[f.key]?.trim(),
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

  const skinClose = skinDesc
    ? ` Final check: skin tone must remain ${skinRaw} (${skinDesc}).`
    : "";

  const referenceClose = useReference
    ? " The output must clearly resemble the reference person while reflecting the requested look."
    : "";

  return [
    skinBlock,
    base,
    personality,
    featureParts,
    defaults,
    "High quality, detailed, even portrait lighting, character-focused.",
    skinClose,
    referenceClose,
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getAppearanceSuggestions(feature) {
  const map = {
    skin: [
      "porcelain fair",
      "light olive",
      "warm peach",
      "golden tan",
      "warm medium brown",
      "deep ebony",
    ],
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
