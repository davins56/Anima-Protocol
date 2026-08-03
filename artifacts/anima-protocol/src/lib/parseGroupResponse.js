/**
 * Parses a multi-character AI response in the format:
 * **CharacterName:** their dialogue or *action*
 *
 * Returns an array of {role, content, character_name, timestamp} message objects.
 * Falls back to a single message attributed to fallbackSpeaker if parsing yields nothing.
 */
export function parseGroupResponse(rawText, groupChars, fallbackSpeaker) {
  if (!rawText || !groupChars?.length) {
    return [{ role: "assistant", content: rawText || "", character_name: fallbackSpeaker, timestamp: new Date().toISOString() }];
  }

  // Build a regex that splits on **KnownCharacterName:** anywhere in the text
  // This handles both line-start and mid-text placements (single-line blobs)
  const nameAlts = groupChars.map(c => c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const splitRegex = new RegExp(`\\*\\*(${nameAlts})\\*\\*:\\s*`, "gi");

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
      timestamp: new Date().toISOString(),
    });
  }

  for (let i = 1; i < parts.length; i += 2) {
    const speakerName = parts[i]?.trim();
    const content = parts[i + 1]?.trim();
    if (!speakerName || !content) continue;

    const known = groupChars.find(c => c.name.toLowerCase() === speakerName.toLowerCase());
    messages.push({
      role: "assistant",
      content,
      character_name: known ? known.name : speakerName,
      timestamp: new Date().toISOString(),
    });
  }

  if (messages.length === 0) {
    messages.push({
      role: "assistant",
      content: rawText.trim(),
      character_name: fallbackSpeaker,
      timestamp: new Date().toISOString(),
    });
  }

  return messages;
}