/**
 * Catch companion replies that step outside the world and narrate it as a
 * franchise. The user's own message is never passed here. In-world talk
 * about a place ("I don't talk about Vormir") must pass through.
 */

const FOURTH_WALL_PATTERNS: RegExp[] = [
  /\bmarvel cinematic universe\b/i,
  /\bcinematic universe\b/i,
  /\bthe mcu\b/i,
  /\bmcu\b/i,
  /\bin the movies\b/i,
  /\bin the films\b/i,
  /\bin the comics\b/i,
  /\bin the movie\b/i,
  /\bin the film\b/i,
  /\bin the comic\b/i,
  /\bin the franchise\b/i,
  /\bfictional universe\b/i,
];

/** True when the companion's reply names the world as fiction or a franchise. */
export function isFourthWallReply(reply: unknown): boolean {
  const text = String(reply ?? "").trim();
  if (!text) return false;
  return FOURTH_WALL_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Shown when the one regenerate is also outside the world. Does not invent
 * a place, a people, or a franchise name.
 */
export function inWorldFourthWallDeflection(name: string | null | undefined): string {
  const who = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (who) {
    return `*${who} meets your eyes.* I don't give tours. Ask me what you actually want to know.`;
  }
  return "*A look, held.* I don't give tours. Ask me what you actually want to know.";
}

/**
 * Appended to the final user turn on the one regenerate. Not part of the
 * cached system prefix.
 */
export function inWorldRetryReminder(name: string | null | undefined): string {
  const who = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stay = who ? `Stay ${who}` : "Stay in your life";
  return `${stay}. The user is physically in your world with you. Speak in the first person, to them, from what you have lived. Do not talk about that life as if it were published, filmed, or drawn, and do not lecture. If you are unsure, stay vague. Do not invent names.`;
}
