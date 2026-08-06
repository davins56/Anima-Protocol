/**
 * Parses a multi-character AI response in the format:
 * **CharacterName:** their dialogue or *action*
 *
 * Returns an array of {role, content, character_name, character_id?, timestamp}
 * message objects. Falls back to a single message attributed to fallbackSpeaker
 * if parsing yields nothing.
 */
export function parseGroupResponse(rawText, groupChars, fallbackSpeaker) {
  const fallbackChar = Array.isArray(groupChars)
    ? groupChars.find(
        (c) =>
          c?.name &&
          String(c.name).toLowerCase() ===
            String(fallbackSpeaker || "").toLowerCase(),
      )
    : null;

  if (!rawText || !groupChars?.length) {
    return [
      {
        role: "assistant",
        content: rawText || "",
        character_name: fallbackSpeaker,
        ...(fallbackChar?.id ? { character_id: fallbackChar.id } : {}),
        timestamp: new Date().toISOString(),
      },
    ];
  }

  // Build a regex that splits on **KnownCharacterName:** anywhere in the text.
  // Prompt format is `**Name:**` (colon inside the bold markers). Also accept
  // `**Name**:` (colon after close) from older / alternate model output.
  const nameAlts = groupChars
    .map((c) => c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const splitRegex = new RegExp(
    `\\*\\*(${nameAlts})(?::\\*\\*|\\*\\*:)\\s*`,
    "gi",
  );

  const parts = rawText.split(splitRegex);
  // split() with a capturing group interleaves [prefix, name, content, name, content, ...]
  // parts[0] = text before first match (often empty/narrator prose)
  // parts[1] = character name, parts[2] = their content, etc.

  const messages = [];

  // Any leading prose before the first character tag
  const leadingProse = parts[0]?.trim();
  if (leadingProse) {
    messages.push({
      role: "assistant",
      content: leadingProse,
      character_name: fallbackSpeaker,
      ...(fallbackChar?.id ? { character_id: fallbackChar.id } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const speakerName = parts[i]?.trim();
    const content = parts[i + 1]?.trim();
    if (!speakerName || !content) continue;

    const known = groupChars.find(
      (c) => c.name.toLowerCase() === speakerName.toLowerCase(),
    );
    messages.push({
      role: "assistant",
      content,
      character_name: known ? known.name : speakerName,
      ...(known?.id ? { character_id: known.id } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: "assistant",
      content: rawText.trim(),
      character_name: fallbackSpeaker,
      ...(fallbackChar?.id ? { character_id: fallbackChar.id } : {}),
      timestamp: new Date().toISOString(),
    });
  }

  return messages;
}
