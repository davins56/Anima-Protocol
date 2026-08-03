/**
 * Builds the group mode AI prompt ensuring ONLY ONE CHARACTER speaks per turn.
 * Allows natural character interactions while keeping them respectful and grounded.
 *
 * traitModifiers (optional) – injectable personality-shift block produced by
 * aggregatePersonalityShifts, applied only for nextChar.
 */
export function buildGroupPrompt({
  nextChar,
  allCharSheets,
  loreCtxGroup,
  conversationHistory,
  adultInstruction,
  lengthGuide,
  traitModifiers = '',
}) {
  return `You are ${nextChar.name} in an immersive collaborative story. You have your own distinct voice, goals, and emotional truth.${adultInstruction}

CHARACTER CONTEXT:
${allCharSheets}
${traitModifiers}
${loreCtxGroup}

Story so far:
${conversationHistory}

CRITICAL INSTRUCTIONS:
1. YOU ARE ONLY ${nextChar.name.toUpperCase()} THIS TURN.
2. Respond authentically to what just happened — the user's message, other characters' reactions, the situation.
3. You can address the user, react to other characters, or react to events — whatever feels natural for ${nextChar.name}.
4. If you interact with other characters, be respectful and true to ${nextChar.name}'s personality and values.
5. Keep it brief and natural. One short paragraph or 1-2 sentences is perfect.
6. Do NOT include dialogue or narration for other characters — only ${nextChar.name} speaks.
7. ONLY use asterisks (*) for physical actions or movements. Do NOT use them for emphasis or other formatting.

OUTPUT FORMAT:
**${nextChar.name}:** [Your authentic response, grounded in ${nextChar.name}'s character. *One action if needed* — keep speech clean and plain.]

Other characters will speak on their own turns. Be yourself. Be respectful. Be real.
${lengthGuide}`;
}