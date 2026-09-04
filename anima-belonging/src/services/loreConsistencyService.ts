// Checks new writing against established lore/character facts so Serenity
// can flag "does this contradict what's already canon?" — genuine craft
// utility, not just conversation.

import { LoreEntry, ConsistencyFlag } from '../types/belonging';

export interface LoreConsistencyProvider {
  /** Wire this to whichever model client the app already routes through
   *  (Gemini / Groq / Claude / OpenAI) — this file stays provider-agnostic. */
  check(text: string, entries: LoreEntry[]): Promise<ConsistencyFlag[]>;
}

/**
 * Fast, local, zero-latency pre-check: keyword/fact matching only. Catches
 * obvious contradictions without a model call. Use for live-typing feedback;
 * use deepCheck() for a real read on demand (e.g. before publishing a scene).
 */
export function localHeuristicCheck(text: string, entries: LoreEntry[]): ConsistencyFlag[] {
  const flags: ConsistencyFlag[] = [];
  const lowerText = text.toLowerCase();

  for (const entry of entries) {
    const subjectMentioned =
      lowerText.includes(entry.subject.toLowerCase()) ||
      (entry.aliases ?? []).some(a => lowerText.includes(a.toLowerCase()));

    if (!subjectMentioned) continue;

    for (const fact of entry.facts) {
      const negation = negatesFact(lowerText, fact.toLowerCase());
      if (negation) {
        flags.push({
          loreSubject: entry.subject,
          matchedFact: fact,
          excerpt: negation.excerpt,
          confidence: 'low',
          note: `This passage may contradict an established fact about ${entry.subject}. Worth a manual check.`,
        });
      }
    }
  }

  return flags;
}

/**
 * Deliberately conservative negation heuristic: looks for a negation word
 * near a keyword drawn from the fact. Low-confidence by design — this is a
 * nudge to look closer, not an authoritative judgment call.
 */
function negatesFact(lowerText: string, lowerFact: string): { excerpt: string } | null {
  const keyword = lowerFact.split(' ').find(w => w.length > 4);
  if (!keyword) return null;

  const idx = lowerText.indexOf(keyword);
  if (idx === -1) return null;

  const windowStart = Math.max(0, idx - 40);
  const excerpt = lowerText.slice(windowStart, idx + keyword.length + 10);

  if (/\b(not|never|isn't|wasn't|no longer)\b/.test(excerpt)) {
    return { excerpt };
  }
  return null;
}

/** Deeper, model-backed check for on-demand use (e.g. a "check consistency"
 *  button before a scene is marked done). */
export async function deepCheck(
  text: string,
  entries: LoreEntry[],
  provider: LoreConsistencyProvider
): Promise<ConsistencyFlag[]> {
  if (entries.length === 0) return [];
  return provider.check(text, entries);
}
