/**
 * Catch stock model-identity lines ("as an AI", "I'm Qwen") on the final
 * reply. In-story refusals ("I won't tell you that", "No.") are not stock
 * lines and must pass through.
 */

import { logger } from "./logger";

const STOCK_LINE_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?an?\s+(?:ai|a\.?\s*i\.?|artificial intelligence)\b/i,
  /\bi(?:\s+am|'m|’m)\s+an?\s+ai\s+(?:language\s+model|assistant)\b/i,
  /\b(?:ai|large)\s+language\s+model\b/i,
  /\bas (?:a|an)\s+(?:language model|chat\s?bot|virtual assistant|artificial intelligence)\b/i,
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?(?:a\s+)?(?:chat\s?bot|language model|large language model|llm|virtual assistant|bot)\b/i,
  /\bi(?:\s+am|'m|’m)\s+(?:just\s+)?(?:a\s+)?(?:computer\s+)?(?:program|software)\b/i,
  /\b(?:je suis|soy|sou|sono)\s+(?:une?|una|um)\s+i\.?\s*a\.?\b/i,
  /\b(?:intelligence artificielle|inteligencia artificial|inteligência artificial)\b/i,
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

/** Persona text that already presents the character as a machine. "as an AI" can be in character. */
const PERSONA_MACHINE_RE = /\b(ai|android|robot|synthetic)\b/i;

export function personaDescribesMachine(
  parts: Array<string | null | undefined> | undefined,
): boolean {
  const blob = (parts || []).map((part) => String(part || "")).join("\n");
  return PERSONA_MACHINE_RE.test(blob);
}

function lineTriggersStock(line: string): boolean {
  const covered = stockMatchCoverage(line);
  if (covered === 0) return false;
  if (line.length <= STOCK_ASSISTANT_SHORT_REPLY_CHARS) return true;
  return covered * 2 >= line.length;
}

/**
 * True for assistant / model-identity lines. Case-insensitive.
 * Buried admissions still count when they appear as their own line.
 * Machine personas (android, robot, synthetic, in-story AI) are exempt.
 */
export function isStockAssistantLine(
  reply: unknown,
  personaParts?: Array<string | null | undefined>,
): boolean {
  if (personaDescribesMachine(personaParts)) return false;
  const text = String(reply ?? "").trim();
  if (!text) return false;
  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.some((line) => lineTriggersStock(line))) return true;
  return lineTriggersStock(text);
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
