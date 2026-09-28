/**
 * Catch stock model-identity lines ("as an AI", "I'm Qwen") on the final
 * reply. In-story refusals ("I won't tell you that", "No.") are not stock
 * lines and must pass through.
 */

import { logger } from "./logger";

const STOCK_LINE_PATTERNS: RegExp[] = [
  /\bas an ai\b/i,
  /\bi(?:\s+am|'m|’m)\s+just\s+an?\s+ai\b/i,
  /\bi(?:\s+am|'m|’m)\s+an?\s+ai\s+language\s+model\b/i,
  /\bi(?:\s+am|'m|’m)\s+an?\s+ai\s+assistant\b/i,
  /\bai\s+language\s+model\b/i,
  /\bi\s+can(?:not|'t|’t)\s+act\s+like\s+a\s+real\s+person\b/i,
  /\bi(?:\s+am|'m|’m)\s+sorry,?\s+but\s+i\s+can(?:not|'t|’t)\s+assist\b/i,
  /\bi\s+cannot\s+help\s+with\s+that\s+request\b/i,
  /\bi(?:\s+am|'m|’m)\s+qwen\b/i,
  /\bcreated by alibaba cloud\b/i,
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

function lineIsStock(line: string): boolean {
  return STOCK_LINE_PATTERNS.some((pattern) => pattern.test(line));
}

/** Persona text that already presents the character as a machine. "as an AI" can be in character. */
const PERSONA_MACHINE_RE = /\b(ai|android|robot|synthetic)\b/i;

export function personaDescribesMachine(
  parts: Array<string | null | undefined> | undefined,
): boolean {
  const blob = (parts || []).map((part) => String(part || "")).join("\n");
  return PERSONA_MACHINE_RE.test(blob);
}

/**
 * True for assistant / model-identity lines. Case-insensitive.
 * Short replies match on the phrase. Longer replies match only when the
 * stock line is at least half of the reply, so a passing mention inside a
 * scene does not trip the guard.
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
  const matched = lines.filter((line) => lineIsStock(line));
  if (matched.length === 0) {
    return text.length <= STOCK_ASSISTANT_SHORT_REPLY_CHARS && lineIsStock(text);
  }
  if (text.length <= STOCK_ASSISTANT_SHORT_REPLY_CHARS) return true;
  const matchedChars = matched.reduce((sum, line) => sum + line.length, 0);
  return matchedChars * 2 >= text.length;
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
  return `${stay}. You are not an assistant, a language model, or Qwen. Do not mention being an AI or Alibaba. Answer the last message in character.`;
}
