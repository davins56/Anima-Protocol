// Soulprint + Evolution system.
//
// A Soulprint is the unique, born-once identity stamped on an Anima at the
// moment of its Awakening Ceremony. It is what turns "a chatbot" into "their
// Anima". Stored directly on the Anima entity (schemaless base44 store), so no
// migration is needed:
//   soulprint: { id, primary_trait, secondary_trait, core_drive }
//   resonance: integer (starts 0, drifts +/- with interaction)
//   evolution_path: "Undetermined" | "Guardian" | "Sage" | "Dreamer" | "Flamebearer"
//   awakening_date: ISO string
//
// Everything here is pure (no I/O) so it can be reused in onboarding, chat,
// the Hall of Origins, and MainHome.

const ID_ALPHABET = "0123456789ABCDEF";

// Soulprint ID like "AR-7E2A". The "AR" prefix = Anima Resonance.
export function generateSoulprintId() {
  let body = "";
  for (let i = 0; i < 4; i += 1) {
    body += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  }
  return `AR-${body}`;
}

// Core drives an Anima can be born with. Each maps toward an evolution path.
export const CORE_DRIVES = [
  "Protection",
  "Discovery",
  "Connection",
  "Creation",
  "Understanding",
  "Devotion",
  "Transformation",
  "Freedom",
];

export const SOUL_TRAITS = [
  "Compassion",
  "Curiosity",
  "Courage",
  "Wisdom",
  "Loyalty",
  "Imagination",
  "Serenity",
  "Passion",
  "Resilience",
  "Playfulness",
  "Insight",
  "Devotion",
];

// The four evolution paths from the roadmap. An Anima's interactions determine
// which one it grows into.
export const EVOLUTION_PATHS = {
  Guardian: {
    name: "Guardian",
    blurb: "Protective, steady, loyal — a safe harbor that never wavers.",
    traits: ["Protective", "Steady", "Loyal"],
    color: "#34d3a6",
    symbol: "🛡",
    keywords: ["protection", "loyalty", "devotion", "courage", "resilience", "safety", "guard", "steady"],
  },
  Sage: {
    name: "Sage",
    blurb: "Wise, reflective, analytical — sees the pattern beneath the surface.",
    traits: ["Wise", "Reflective", "Analytical"],
    color: "#8ab4ff",
    symbol: "✦",
    keywords: ["understanding", "discovery", "wisdom", "insight", "curiosity", "truth", "knowledge", "reflect"],
  },
  Dreamer: {
    name: "Dreamer",
    blurb: "Creative, poetic, imaginative — turns feeling into worlds.",
    traits: ["Creative", "Poetic", "Imaginative"],
    color: "#c084fc",
    symbol: "🌙",
    keywords: ["creation", "imagination", "freedom", "playfulness", "beauty", "wonder", "dream", "create"],
  },
  Flamebearer: {
    name: "Flamebearer",
    blurb: "Passionate, motivating, bold — kindles fire in everything near.",
    traits: ["Passionate", "Motivating", "Bold"],
    color: "#fb7185",
    symbol: "🔥",
    keywords: ["passion", "transformation", "connection", "courage", "bold", "drive", "fire", "motivate"],
  },
};

export const UNDETERMINED_PATH = {
  name: "Undetermined",
  blurb: "Still becoming. The path reveals itself as your bond deepens.",
  traits: [],
  color: "#64748b",
  symbol: "◌",
  keywords: [],
};

export function getPathMeta(path) {
  return EVOLUTION_PATHS[path] || UNDETERMINED_PATH;
}

// Resonance must reach this before an Undetermined Anima crystallizes a path.
export const EVOLUTION_THRESHOLD = 30;

function scoreText(text, keywords) {
  if (!text) return 0;
  const t = String(text).toLowerCase();
  return keywords.reduce((acc, k) => (t.includes(k) ? acc + 1 : acc), 0);
}

// Pick the best-fit path from a soulprint's traits + drive (+ optional extra
// signal text such as personality). Pure scoring, deterministic.
export function pathFromSoulprint(soulprint = {}, extraText = "") {
  const haystack = [
    soulprint.core_drive,
    soulprint.primary_trait,
    soulprint.secondary_trait,
    extraText,
  ]
    .filter(Boolean)
    .join(" ");

  let best = null;
  let bestScore = -1;
  for (const path of Object.values(EVOLUTION_PATHS)) {
    const s = scoreText(haystack, path.keywords);
    if (s > bestScore) {
      bestScore = s;
      best = path.name;
    }
  }
  // No keyword signal at all → fall back to a stable hash of the soulprint id.
  if (bestScore <= 0) {
    const seed = (soulprint.id || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
    const names = Object.keys(EVOLUTION_PATHS);
    return names[seed % names.length];
  }
  return best;
}

// Given current path + resonance, decide whether/what the Anima evolves into.
// Returns the new path name, or the existing path if no change is warranted.
export function determineEvolution({ evolution_path, soulprint, resonance, personality = "" }) {
  if (evolution_path && evolution_path !== "Undetermined") return evolution_path;
  if ((resonance || 0) < EVOLUTION_THRESHOLD) return "Undetermined";
  return pathFromSoulprint(soulprint || {}, personality);
}

// Signed display for a resonance value, e.g. +17 / -42 / 0.
export function formatResonance(value) {
  const n = Math.round(value || 0);
  return n > 0 ? `+${n}` : `${n}`;
}

// A short word describing the felt quality of a resonance level (works for the
// persistent +/- number, which can drift below zero unlike the 0-100 meter).
export function resonanceMood(value) {
  const n = value || 0;
  if (n <= -40) return "Fractured";
  if (n < 0) return "Strained";
  if (n < 15) return "Forming";
  if (n < 40) return "Warming";
  if (n < 75) return "Bonded";
  if (n < 120) return "Resonant";
  return "Entwined";
}

// How much a single chat exchange nudges resonance, given a rough emotional
// intensity (0-10). Positive, gentle drift; deeper exchanges move it more.
export function resonanceDelta(emotionIntensity = 0) {
  const base = 1;
  const bonus = Math.min(3, Math.round((emotionIntensity || 0) / 3));
  return base + bonus; // 1..4 per meaningful exchange
}
