export const CHAT_MODES = Object.freeze({
  standard: Object.freeze({
    name: "standard",
    adultAllowed: false,
    safetyProfile: "standard",
    promptModules: ["identity", "relationship", "memory", "world", "conversation"],
  }),
  therapy: Object.freeze({
    name: "therapy",
    adultAllowed: false,
    safetyProfile: "care",
    promptModules: [
      "identity",
      "relationship",
      "memory",
      "world",
      "therapy-safety",
      "conversation",
    ],
  }),
  adult: Object.freeze({
    name: "adult",
    adultAllowed: true,
    safetyProfile: "adult",
    promptModules: ["identity", "relationship", "memory", "world", "conversation"],
  }),
  crossover: Object.freeze({
    name: "crossover",
    adultAllowed: false,
    safetyProfile: "crossover",
    promptModules: [
      "identity",
      "relationship",
      "memory",
      "world",
      "crossover",
      "conversation",
    ],
  }),
});

export function resolveClientChatMode({
  therapy = false,
  adult = false,
  crossover = false,
} = {}) {
  if (therapy) return CHAT_MODES.therapy;
  if (crossover) return CHAT_MODES.crossover;
  if (adult) return CHAT_MODES.adult;
  return CHAT_MODES.standard;
}
