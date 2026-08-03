/**
 * Voice Anchors
 *
 * Extracts and formats few-shot voice examples that ground how a specific
 * companion speaks and behaves. These anchors keep the character's voice
 * consistent across long conversations and prevent drift.
 */

export interface CharacterData {
  id?: string;
  name?: string;
  personality?: string;
  speaking_style?: string;
  backstory?: string;
  universe?: string;
  archetype?: string;
  tagline?: string;
  _isAnima?: boolean;
  [key: string]: unknown;
}

export interface VoiceAnchor {
  context: string;
  example: string;
}

/**
 * Extract voice anchors from a character's speaking style and personality.
 * Generates concise behavioral examples the model can pattern-match.
 */
export function extractVoiceAnchors(character: CharacterData): VoiceAnchor[] {
  const anchors: VoiceAnchor[] = [];

  // Parse speaking_style for concrete voice patterns
  if (character.speaking_style) {
    const style = character.speaking_style;

    // Look for quoted examples in the speaking style
    const quotedExamples = style.match(/"[^"]{10,120}"/g);
    if (quotedExamples) {
      for (const quote of quotedExamples.slice(0, 3)) {
        anchors.push({
          context: "characteristic phrase",
          example: quote.replace(/^"|"$/g, ""),
        });
      }
    }

    // Look for action descriptions (*action*)
    const actionExamples = style.match(/\*[^*]{5,80}\*/g);
    if (actionExamples) {
      for (const action of actionExamples.slice(0, 2)) {
        anchors.push({
          context: "physical mannerism",
          example: action,
        });
      }
    }
  }

  // Derive voice notes from personality
  if (character.personality && anchors.length < 3) {
    const traits = character.personality.split(/[,;.]/).map((t) => t.trim()).filter(Boolean);
    const voiceTraits = traits.slice(0, 3);
    if (voiceTraits.length) {
      anchors.push({
        context: "core voice traits",
        example: voiceTraits.join(", "),
      });
    }
  }

  return anchors;
}

/**
 * Format voice anchors into a prompt-injectable block.
 */
export function formatVoiceAnchors(
  character: CharacterData,
  anchors: VoiceAnchor[],
): string {
  if (anchors.length === 0) return "";

  const name = character.name || "Companion";
  const lines = anchors.map((a) => `• [${a.context}] ${a.example}`);

  return `VOICE ANCHORS for ${name} (stay true to this voice):\n${lines.join("\n")}`;
}

/**
 * Build crossover awareness context when multiple characters are present.
 * Each character is aware of the others and can react to their presence.
 */
export function buildCrossoverAwareness(
  activeCharacter: CharacterData,
  allCharacters: CharacterData[],
): string {
  const others = allCharacters.filter(
    (c) => c.id !== activeCharacter.id && c.name !== activeCharacter.name,
  );
  if (others.length === 0) return "";

  const otherDescriptions = others
    .map((c) => {
      const parts = [c.name || "Unknown"];
      if (c.universe) parts.push(`from ${c.universe}`);
      if (c.archetype) parts.push(`(${c.archetype})`);
      return `• ${parts.join(" ")}`;
    })
    .join("\n");

  const activeUniverses = new Set(
    allCharacters.map((c) => c.universe).filter(Boolean),
  );
  const isCrossUniverse = activeUniverses.size >= 2;

  let awareness = `CROSSOVER AWARENESS — Others present in this scene:\n${otherDescriptions}`;

  if (isCrossUniverse) {
    awareness += `\n\nThis is a CROSS-UNIVERSE encounter. Characters from different worlds are meeting. React authentically — with wonder, wariness, recognition, or tension as your character would. Reference the strangeness or significance of worlds colliding.`;
  } else {
    awareness += `\n\nThese characters share your world. React to them as you naturally would — as allies, rivals, strangers, or something more complex.`;
  }

  return awareness;
}
