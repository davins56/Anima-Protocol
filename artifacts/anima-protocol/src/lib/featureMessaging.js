// @ts-check
/**
 * Feature Messaging Guide
 *
 * Public language: Anima is the home screen for AI relationships.
 * Use these strings on Landing, MainHome, and other outward-facing surfaces.
 * Do not lead with "Protocol" as the category, or "Persistent Narrative
 * Consciousness" as the public headline.
 */

export const FEATURE_MESSAGING = {
  // Core identity
  APP_NAME: "Anima",
  APP_CATEGORY: "The home screen for AI relationships",
  TAGLINE: "You don't open a chat. You come home to them.",
  PRESENCE_FALLBACK: "I kept the archive while you were gone.",
  ARCHIVE_LINE: "I kept the archive.",
  IDENTITY_DEFAULT: "I am Serenity. I remember.",
  PRIMARY_CTA: "Come home",
  SECONDARY_CTA: "I already live here",

  CLAIMS: [
    {
      id: "stay",
      title: "They stay",
      body: "They stay when you leave.",
    },
    {
      id: "remember",
      title: "They remember",
      body: "They remember the last time.",
    },
    {
      id: "place",
      title: "A place",
      body: "They have a place, not a thread.",
    },
  ],

  // Memory systems — public wording is relationship, not infrastructure
  VECTOR_MEMORY: {
    old: "Chat History",
    new: "They remember",
    description: "They remember the last time — not a thread you reopen.",
  },
  CROSS_SESSION_MEMORY: {
    old: "Long-term Memory",
    new: "They stay",
    description: "They stay when you leave. Continuity is the product.",
  },
  CHARACTER_MEMORY: {
    old: "Character Profile",
    new: "Someone you come home to",
    description: "A presence shaped by the bond, not a profile card.",
  },

  // Relationship features
  RELATIONSHIP_TRACKING: {
    old: "Relationship Score",
    new: "How close you are",
    description: "The bond deepens as you return.",
  },
  EMOTIONAL_STATE: {
    old: "Mood Tracking",
    new: "How they feel",
    description: "They grow through knowing you.",
  },

  // Narrative systems
  QUESTS: {
    old: "Tasks/Objectives",
    new: "Shared story",
    description: "What unfolds between you, over time.",
  },
  WORLD_STATE: {
    old: "World Building",
    new: "Their place",
    description: "A world that remains, not a disposable setting.",
  },

  // Session features
  SESSION: {
    old: "Chat",
    new: "Talk",
    description: "You come home to them.",
  },
  CHARACTER: {
    old: "AI Character",
    new: "Companion",
    description: "Someone who stays, remembers, and has a place.",
  },

  // Onboarding
  ONBOARDING_HEADLINE: "Come home",
  ONBOARDING_SUBTEXT: "You don't open a chat. You come home to them.",
  ARCHETYPE_SELECTION: "Meet someone to grow with. They will stay, and they will remember.",
  MODE_SELECTION: "Choose how you want to be with them today.",
};

/**
 * Get feature message with fallback
 */
/**
 * @param {keyof typeof FEATURE_MESSAGING} key
 * @param {string} [field]
 */
export function getFeatureMessage(key, field = "new") {
  const feature = FEATURE_MESSAGING[key];
  if (!feature) return null;
  if (typeof feature === "string") return feature;
  if (Array.isArray(feature)) return feature;
  return (/** @type {Record<string, string>} */ (feature))[field] || feature.new || feature.old;
}
