/**
 * Detects lore keywords in text and returns matches with their entries
 * @param {string} text - The text to search
 * @param {array} loreEntries - Array of lore objects with 'subject' and 'fact' fields
 * @returns {array} Array of matches with {keyword, subject, start, end, entry}
 */
export function detectLoreKeywords(text, loreEntries = []) {
  if (!text || !loreEntries.length) return [];

  const matches = [];
  const seen = new Set();

  // Sort by length descending to match longer phrases first
  const sorted = [...loreEntries].sort(
    (a, b) => (b.subject?.length || 0) - (a.subject?.length || 0)
  );

  sorted.forEach((entry) => {
    if (!entry.subject) return;

    const regex = new RegExp(`\\b${entry.subject}\\b`, "gi");
    let match;

    while ((match = regex.exec(text)) !== null) {
      // Avoid duplicate matches at same position
      const key = `${match.index}-${match.index + match[0].length}`;
      if (!seen.has(key)) {
        seen.add(key);
        matches.push({
          keyword: match[0],
          subject: entry.subject,
          start: match.index,
          end: match.index + match[0].length,
          entry,
        });
      }
    }
  });

  // Sort by position in text
  return matches.sort((a, b) => a.start - b.start);
}

/**
 * Splits text into segments based on keyword matches
 * @param {string} text - The text to split
 * @param {array} matches - Array of matches from detectLoreKeywords
 * @returns {array} Array of segments with {type: 'text'|'keyword', content, entry}
 */
export function createLoreSegments(text, matches) {
  if (!matches.length) {
    return [{ type: "text", content: text }];
  }

  const segments = [];
  let lastEnd = 0;

  matches.forEach((match) => {
    // Add text before keyword
    if (match.start > lastEnd) {
      segments.push({
        type: "text",
        content: text.slice(lastEnd, match.start),
      });
    }

    // Add keyword
    segments.push({
      type: "keyword",
      content: match.keyword,
      entry: match.entry,
    });

    lastEnd = match.end;
  });

  // Add remaining text
  if (lastEnd < text.length) {
    segments.push({
      type: "text",
      content: text.slice(lastEnd),
    });
  }

  return segments;
}