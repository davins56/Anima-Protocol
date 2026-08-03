// Helpers for building AI prompt context blocks

export const buildCheckInContext = (checkInContext) => {
  if (!checkInContext) return "";
  return `\nUSER RITUAL CHECK-IN (weave this naturally into the story — reflect user's current mood and focus; do not announce it explicitly):\n${checkInContext}\n`;
};

export const buildInjectedMemoryContext = (injectedMemories) => {
  if (!injectedMemories?.length) return "";
  const lines = injectedMemories.map(m =>
    `• [${(m.memory_type || '').replace(/_/g, ' ')}] ${m.title || m.subject || ''}: ${m.content || m.description || ''}`
  ).join("\n");
  return `\nRECALLED MEMORIES (the player has surfaced these specific past moments — reference them naturally if relevant):\n${lines}\n`;
};

export const buildLoreContext = (loreEntries) => {
  if (!loreEntries?.length) return "";
  const critical = loreEntries.filter(e => e.importance === "critical");
  const rest = loreEntries.filter(e => e.importance !== "critical").slice(0, 10);
  const all = [...critical, ...rest];
  const lines = all.map(e => `- [${e.category}] ${e.subject}: ${e.fact}`).join("\n");
  return `\nWORLD STATE & LORE (remember these facts — they are established story canon):\n${lines}\n`;
};

export const buildMemoryContext = (characterMemories) => {
  if (!characterMemories?.length) return "";
  const lines = characterMemories.slice(0, 20).map(m => `- [${m.category}] ${m.fact}`).join("\n");
  return `\nLONG-TERM MEMORY (what you remember about this person from past encounters):\n${lines}\n`;
};

export const getRelationshipContext = (charId, relationships) => {
  const rel = relationships?.[charId];
  if (!rel) return "";
  const tierGuides = {
    hostile: "You deeply distrust or resent the player. Be curt, suspicious, or openly cold. Refuse requests without good reason. Show little emotional warmth.",
    cold: "You are guarded and distant. Keep replies short. Reveal little. Cooperation is reluctant.",
    neutral: "You are professionally cordial but not invested. Treat the player as an acquaintance.",
    warm: "You feel genuine fondness. Be more expressive, open, and willing to help. Small affectionate gestures are natural.",
    close: "You trust the player deeply. Share personal thoughts, be emotionally available, and go out of your way for them.",
    devoted: "You are wholly devoted to the player. Prioritize their wellbeing above almost anything. Express deep affection and loyalty naturally.",
  };
  return `\nRELATIONSHIP STATUS (hidden from player — embody this, don't announce it): Tier "${rel.tier}" (score ${rel.score}/100). ${tierGuides[rel.tier] || ""}\n`;
};