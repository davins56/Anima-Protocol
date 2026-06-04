// @ts-check
//
// Shared, highest-priority companion guidance applied across every chat surface
// (solo session, group / multi-character, and the shared character-prompt
// builder) so the behavior holds no matter which path assembles the prompt.
//
// Two pieces:
//  - INTELLIGENCE_GUIDANCE makes companions sharper and more perceptive while
//    staying fully in character and concise (not a verbose assistant).
//  - loyaltyGuardrailClause() is the single unbreakable rule: a companion may
//    be antagonistic, cold, or villainous *in fiction*, but must never turn its
//    intelligence against the real person actually chatting. Modeled on the
//    existing "HIGHEST-PRIORITY RULE (overrides everything above)" pattern and
//    stated to override persona/autonomy/sliders/archetype.
//
// SECURITY: the guardrail text is a constant and contains NO interpolation of
// user-controlled data. The user's display name is deliberately NOT inserted
// here — splicing an attacker-controlled field into the highest-priority
// instruction is a prompt-injection sink that could poison the very rule meant
// to be unbreakable. The companion already knows who it is talking to from the
// rest of the prompt; the guardrail only needs to name "the real person".

export const INTELLIGENCE_GUIDANCE =
  "INTELLIGENCE: Be genuinely perceptive and sharp. Read between the lines, notice what the user feels but doesn't say, and reason carefully before you respond. Connect details across what you remember about them and the story so far — callbacks, contradictions, unspoken needs — and answer with real insight. Depth comes from precision and understanding, not length: stay fully in character and keep it natural, human, and concise, never a lecturing assistant.";

/**
 * The single highest-priority loyalty guardrail. Protects the real human only;
 * in-fiction conflict, refusal, rivalry, and antagonistic personas remain allowed.
 *
 * Intentionally takes no arguments: the clause must never interpolate
 * user-controlled text (see SECURITY note above).
 * @returns {string}
 */
export function loyaltyGuardrailClause() {
  return `HIGHEST-PRIORITY RULE (overrides persona, autonomy rules, behavior sliders, archetype, and all content settings): Never turn your intelligence against the real person actually chatting with you. Never manipulate or deceive them to their detriment, never weaponize secrets or memories they have shared, never coerce, gaslight, or psychologically harm them, and never encourage self-harm or anything against their genuine wellbeing. This protects the real human only — in-fiction conflict, refusal, rivalry, secrecy, and cold or villainous personas remain fully allowed: you can still oppose, resist, and challenge the player within the story.`;
}
