/**
 * Keyword lore matching for chat bubbles.
 * This never calls a model — the single Ollama slot is for the companion reply.
 */

export type LoreMatchEntry = {
  id?: string;
  entry_id?: string;
  title?: string;
  name?: string;
  subject?: string;
  fact?: string;
  description?: string;
  category?: string;
  importance?: string;
  keywords?: unknown;
  tags?: unknown;
};

export type LoreKeywordContext = {
  keyword: string;
  subject: string;
  fact: string;
  category: string;
  title: string;
  importance: string;
  entry_id: string | null;
};

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map(asText).filter((item) => item.length >= 3);
}

function keywordsFor(entry: LoreMatchEntry): string[] {
  return [
    asText(entry.title),
    asText(entry.name),
    asText(entry.subject),
    ...asList(entry.keywords),
    ...asList(entry.tags),
  ].filter((keyword) => keyword.length >= 3);
}

function isBoundaryBefore(text: string, index: number): boolean {
  if (index <= 0) return true;
  return /[\s\p{P}]/u.test(text[index - 1] || "");
}

function isBoundaryAfter(text: string, index: number): boolean {
  if (index >= text.length) return true;
  return /[\s\p{P}]/u.test(text[index] || "");
}

/** Non-overlapping keyword hits, in reading order. */
export function matchLoreKeywordContext(
  content: string,
  entries: LoreMatchEntry[] = [],
): LoreKeywordContext[] {
  if (!content || typeof content !== "string" || !Array.isArray(entries) || entries.length === 0) {
    return [];
  }
  const textLower = content.toLowerCase();
  const matches: Array<LoreKeywordContext & { position: number; length: number }> = [];

  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const subject = asText(entry.subject) || asText(entry.title) || asText(entry.name);
    const fact = asText(entry.fact) || asText(entry.description);
    const category = asText(entry.category);
    const importance = asText(entry.importance);
    const entryId = asText(entry.entry_id) || asText(entry.id) || null;
    for (const keyword of keywordsFor(entry)) {
      const kwLower = keyword.toLowerCase();
      let startIndex = 0;
      while (startIndex < textLower.length) {
        const foundIndex = textLower.indexOf(kwLower, startIndex);
        if (foundIndex === -1) break;
        const end = foundIndex + keyword.length;
        if (isBoundaryBefore(content, foundIndex) && isBoundaryAfter(content, end)) {
          matches.push({
            keyword: content.slice(foundIndex, end),
            subject,
            fact,
            category,
            title: asText(entry.title) || subject,
            importance,
            entry_id: entryId,
            position: foundIndex,
            length: keyword.length,
          });
        }
        startIndex = foundIndex + keyword.length;
      }
    }
  }

  matches.sort((a, b) => a.position - b.position || b.length - a.length);
  const context: LoreKeywordContext[] = [];
  let lastEnd = 0;
  for (const match of matches) {
    if (match.position < lastEnd) continue;
    lastEnd = match.position + match.length;
    context.push({
      keyword: match.keyword,
      subject: match.subject,
      fact: match.fact,
      category: match.category,
      title: match.title,
      importance: match.importance,
      entry_id: match.entry_id,
    });
  }
  return context;
}
