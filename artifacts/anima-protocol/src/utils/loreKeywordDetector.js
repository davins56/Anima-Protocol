/**
 * Detects lore keywords in chat or text content and builds segments for tooltips.
 */

export function detectLoreKeywords(content, loreEntries = []) {
  if (!content || typeof content !== "string" || !Array.isArray(loreEntries) || loreEntries.length === 0) {
    return [];
  }

  const matches = [];
  const textLower = content.toLowerCase();

  for (const entry of loreEntries) {
    if (!entry) continue;
    const keywords = [
      entry.title,
      entry.name,
      ...(Array.isArray(entry.keywords) ? entry.keywords : []),
      ...(Array.isArray(entry.tags) ? entry.tags : []),
    ].filter((k) => typeof k === "string" && k.trim().length >= 3);

    for (const keyword of keywords) {
      const kwLower = keyword.toLowerCase();
      let startIndex = 0;

      while (startIndex < textLower.length) {
        const foundIndex = textLower.indexOf(kwLower, startIndex);
        if (foundIndex === -1) break;

        // Ensure word boundaries or basic spacing
        const isWordStart = foundIndex === 0 || /[\s\p{P}]/u.test(content[foundIndex - 1]);
        const isWordEnd =
          foundIndex + keyword.length >= content.length ||
          /[\s\p{P}]/u.test(content[foundIndex + keyword.length]);

        if (isWordStart && isWordEnd) {
          matches.push({
            keyword: content.slice(foundIndex, foundIndex + keyword.length),
            entry,
            position: foundIndex,
            length: keyword.length,
          });
        }

        startIndex = foundIndex + keyword.length;
      }
    }
  }

  // Sort matches by position and deduplicate overlaps
  matches.sort((a, b) => a.position - b.position || b.length - a.length);

  const nonOverlapping = [];
  let lastEnd = 0;

  for (const m of matches) {
    if (m.position >= lastEnd) {
      nonOverlapping.push(m);
      lastEnd = m.position + m.length;
    }
  }

  return nonOverlapping;
}

export function createLoreSegments(content, matches = []) {
  if (!content || typeof content !== "string") {
    return [];
  }
  if (!Array.isArray(matches) || matches.length === 0) {
    return [{ type: "text", content }];
  }

  const segments = [];
  let cursor = 0;

  for (const match of matches) {
    if (match.position > cursor) {
      segments.push({
        type: "text",
        content: content.slice(cursor, match.position),
      });
    }

    segments.push({
      type: "keyword",
      content: match.keyword,
      entry: match.entry,
    });

    cursor = match.position + match.length;
  }

  if (cursor < content.length) {
    segments.push({
      type: "text",
      content: content.slice(cursor),
    });
  }

  return segments;
}
