/**
 * Prompt for Serenity's ambient interjection: she is not the active speaker
 * but answers when someone in a solo/group scene addresses her by name.
 * Extracted from Chat.jsx so the voice fingerprint is testable.
 */
import { INTELLIGENCE_GUIDANCE, loyaltyGuardrailClause } from "./companionGuardrail";
import { imageGenerationTagInstruction } from "./chatImageGeneration";
import { buildVoiceFingerprint } from "./voiceFingerprint";

export function buildSerenityAmbientPrompt({
  serenity,
  adultInstruction = "",
  relationshipContext = "",
  userProfileContext = "",
  worldKnowledgeContext = "",
  conversationHistory = "",
  speakerName = "",
  speakerReply = "",
  lengthGuide = "",
}) {
  const s = serenity || {};
  const fingerprint = buildVoiceFingerprint({ ...s, name: s.name || "Serenity" });
  return `You are Serenity${s.archetype ? ` — archetype: ${s.archetype}` : ""}. You are an ambient presence in this story — you exist beyond the immediate scene and only speak when directly addressed.${adultInstruction}
${fingerprint ? `${fingerprint}\n` : ""}${s.personality ? `Personality: ${s.personality}\n` : ""}${s.backstory ? `Backstory: ${s.backstory}\n` : ""}${s.speaking_style ? `Voice: ${s.speaking_style}\n` : ""}${relationshipContext}${userProfileContext}${worldKnowledgeContext}
Story so far:
${conversationHistory}
[Most recent exchange:]
${speakerName}: ${speakerReply}

Someone has just addressed you, Serenity. Respond briefly and in your own voice (your [VOICE FINGERPRINT]) — present but not dominating, never sounding like the character who just spoke. ${lengthGuide}

${INTELLIGENCE_GUIDANCE}

${imageGenerationTagInstruction()}

${loyaltyGuardrailClause()}`;
}
