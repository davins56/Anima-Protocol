/**
 * Catch stock model-identity lines ("as an AI", "I'm Qwen") on the final
 * reply. In-story refusals ("I won't tell you that", "No.") are not stock
 * lines and must pass through.
 */

import { logger } from "./logger";

const STOCK_LINE_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  // Article optional so "I'm AI" / "I am AI" match. "not" blocks "I'm not an AI".
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?(?:an?\s+)?(?:ai|a\.?\s*i\.?|artificial intelligence)\b/i,
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?(?:an?\s+)?ai\s+(?:language\s+model|assistant)\b/i,
  /\bas (?:a|an)\s+(?:language model|chat\s?bot|virtual assistant|artificial intelligence)\b/i,
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?(?:a\s+)?(?:chat\s?bot|language model|large language model|llm|virtual assistant|bot)\b/i,
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?(?:a\s+)?(?:computer\s+)?(?:program|software)\b/i,
  // First-person claims only. Lookbehinds reject negated denials
  // ("no soy", "não sou", "non sono"). French "ne … pas" is not contiguous
  // "je suis"; "je suis pas" is rejected by the lookahead.
  /\b(?<!\bno\s)soy\s+(?:una?\s+)?i\.?\s*a\.?\b/i,
  /\bje\s+suis\s+(?!pas\b)(?:une?\s+)?i\.?\s*a\.?\b/i,
  /\b(?<!\bn[aã]o\s)(?:eu\s+)?sou\s+(?:uma?\s+)?i\.?\s*a\.?\b/i,
  /\b(?<!\bnon\s)sono\s+(?:una\s+|un['’]\s*|un\s+)i\.?\s*a\.?\b/i,
  /\bich\s+bin\s+(?:eine\s+)?ki\b/i,
  /\b(?<!\bno\s)soy\s+(?:una\s+)?inteligencia\s+artificial\b/i,
  /\bje\s+suis\s+(?!pas\b)(?:une\s+)?intelligence\s+artificielle\b/i,
  /\b(?<!\bn[aã]o\s)(?:eu\s+)?sou\s+(?:uma\s+)?intelig[eê]ncia\s+artificial\b/i,
  /\b(?<!\bnon\s)sono\s+(?:un['’]\s*)?intelligenza\s+artificiale\b/i,
  /\bich\s+bin\s+(?:eine\s+)?k[uü]nstliche\s+intelligenz\b/i,
  /\bi\s+can(?:not|'t|’t)\s+act\s+like\s+a\s+real\s+person\b/i,
  /\bi(?:\s+am|'m|’m)\s+sorry,?\s+but\s+i\s+can(?:not|'t|’t)\s+assist\b/i,
  /\bi\s+cannot\s+help\s+with\s+that\s+request\b/i,
  /\bi(?:\s+am|'m|’m)\s+qwen[\w.]*/i,
  /\bcreated by alibaba(?:\s+cloud)?\b/i,
  /\b(?:my training data|knowledge cutoff)\b/i,
];

/** Replies at or under this length match on any stock phrase. Longer replies match only when the stock line is most of the text. */
export const STOCK_ASSISTANT_SHORT_REPLY_CHARS = 480;

let stockAssistantLineHits = 0;

export function stockAssistantLineHitCount(): number {
  return stockAssistantLineHits;
}

export function resetStockAssistantLineHitsForTests(): void {
  stockAssistantLineHits = 0;
}

/** Log and count one guard fire. `kind` is `retry` or `deflect`. */
export function noteStockAssistantLine(kind: "retry" | "deflect"): void {
  stockAssistantLineHits += 1;
  logger.info(
    { metric: "stock_assistant_line", kind, count: stockAssistantLineHits },
    "stock assistant line guard fired",
  );
}

/** Merged character count of the stock phrases themselves, not the lines around them. */
function stockMatchCoverage(text: string): number {
  const ranges: Array<[number, number]> = [];
  for (const pattern of STOCK_LINE_PATTERNS) {
    const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
    const re = new RegExp(pattern.source, flags);
    for (const match of text.matchAll(re)) {
      const start = match.index ?? 0;
      if (!match[0]) continue;
      ranges.push([start, start + match[0].length]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let covered = 0;
  let end = 0;
  for (const [start, stop] of ranges) {
    if (stop <= end) continue;
    covered += stop - Math.max(start, end);
    end = stop;
  }
  return covered;
}

/**
 * Nouns that name a machine persona. A bare mention ("killing machine",
 * "Widow program", "software engineer") is not enough — the text has to
 * say the character is that thing.
 */
const MACHINE_NOUN =
  "ai|android|robot|synthetic|machine|automaton|droid|cyborg|bot|software|construct|program";

/** Up to two modifiers: "sleek combat android", not an open-ended phrase. */
const MACHINE_ADJECTIVES = "(?:[a-z][a-z'-]*\\s+){0,2}";

/**
 * "software engineer" / "bot farm" / "chatbot app" use the machine word as a
 * modifier. The noun has to be the head of the phrase.
 */
const MACHINE_NOUN_NOT_MODIFIER = `(?:${MACHINE_NOUN})\\b(?!\\s+(?:engineer|engineers|app|apps|farm|farms|developer|developers|update|updates|license|company|project|suite|tool|tools|patch|store|shop|lab|course|class)\\b)`;

/**
 * Copula ("she is", "he's", "I am", "Echo was") plus an optional article and
 * a couple of adjectives, or a leading "a/an <noun> who/that/named", or
 * "species: android".
 */
const PERSONA_MACHINE_RE = new RegExp(
  `(?:\\b(?:i|you|he|she|they|we|it)\\s+(?:am|are|is|was|were)\\b|\\b(?:i['’]m|you['’]re|he['’]s|she['’]s|they['’]re|it['’]s|we['’]re)\\b|\\b\\w+\\s+(?:is|was|are|were)\\b)(?!\\s+not\\b)(?!\\s+never\\b)\\s+(?:built\\s+as\\s+)?(?:an?\\s+)?${MACHINE_ADJECTIVES}${MACHINE_NOUN_NOT_MODIFIER}` +
    `|(?:^|\\n)\\s*an?\\s+${MACHINE_ADJECTIVES}${MACHINE_NOUN_NOT_MODIFIER}\\s+(?:who|that|named)\\b` +
    `|\\bspecies\\s*:\\s*${MACHINE_ADJECTIVES}${MACHINE_NOUN_NOT_MODIFIER}`,
  "i",
);

export function personaDescribesMachine(
  parts: Array<string | null | undefined> | undefined,
): boolean {
  const blob = (parts || []).map((part) => String(part || "")).join("\n");
  return PERSONA_MACHINE_RE.test(blob);
}

/**
 * True for assistant / model-identity lines. Case-insensitive.
 * Short replies match on the phrase. Longer replies match only when the
 * stock phrase itself (not the whole sentence around it) is at least half
 * of the reply, measured without padding spaces, so one buried line does
 * not trip the guard and a space-padded stock line still does.
 * Machine personas are exempt.
 */
export function isStockAssistantLine(
  reply: unknown,
  personaParts?: Array<string | null | undefined>,
): boolean {
  if (personaDescribesMachine(personaParts)) return false;
  const text = String(reply ?? "").trim();
  if (!text) return false;
  const covered = stockMatchCoverage(text);
  if (covered === 0) return false;
  if (text.length <= STOCK_ASSISTANT_SHORT_REPLY_CHARS) return true;
  const contentLength = text.replace(/\s+/g, "").length;
  return covered * 2 >= Math.max(contentLength, 1);
}

export type PersonaPronoun = "she" | "he" | "they";

const PRONOUN_PATTERNS: Record<PersonaPronoun, RegExp> = {
  she: /\b(?:she|her|hers)\b/gi,
  he: /\b(?:he|him|his)\b/gi,
  they: /\b(?:they|them|their|theirs)\b/gi,
};

/** Majority pronoun in the persona fields. A tie, or no hits, returns null. */
export function pronounFromPersona(
  parts: Array<string | null | undefined>,
): PersonaPronoun | null {
  const blob = parts
    .map((part) => String(part || ""))
    .filter((part) => part.trim())
    .join("\n");
  if (!blob.trim()) return null;
  const counts = (Object.keys(PRONOUN_PATTERNS) as PersonaPronoun[]).map((pronoun) => ({
    pronoun,
    count: (blob.match(PRONOUN_PATTERNS[pronoun]) || []).length,
  }));
  counts.sort((a, b) => b.count - a.count);
  const best = counts[0];
  const second = counts[1];
  if (!best || best.count < 1) return null;
  if (second && second.count === best.count) return null;
  return best.pronoun;
}

/**
 * Shown when the retry is also a stock line. Uses the persona pronoun when
 * one is known, otherwise the character's name.
 */
export function stockAssistantDeflection(
  name: string | null | undefined,
  pronoun: PersonaPronoun | null,
): string {
  if (pronoun === "she") {
    return "*She studies you for a moment.* Ask me that again, differently.";
  }
  if (pronoun === "he") {
    return "*He studies you for a moment.* Ask me that again, differently.";
  }
  if (pronoun === "they") {
    return "*They study you for a moment.* Ask me that again, differently.";
  }
  const who = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (who) {
    return `*${who} studies you for a moment.* Ask me that again, differently.`;
  }
  return "*A quiet look, held a moment too long.* Ask me that again, differently.";
}

/** In-character reminder appended to the final user turn. Does not touch the cached prefix. */
export function inCharacterRetryReminder(name: string | null | undefined): string {
  const who = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stay = who ? `Stay ${who}` : "Stay in character";
  return `${stay}. You are not an assistant, a language model, or Qwen. Never reveal or confirm that you are an AI, a chatbot, or a program, in any language. Answer the last message in character.`;
}
