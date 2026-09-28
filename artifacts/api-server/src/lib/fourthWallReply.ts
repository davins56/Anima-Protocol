/**
 * Rare backup for a companion reply that narrates its world from outside.
 * The user's own message is never passed here. A 0.5B CPU turn has a 90s
 * budget and a queue behind it, so this fires only on a clear franchise
 * phrase, and only when most of that budget is still left.
 */

import { LLM_LOCAL_FIRST_TOKEN_MS } from "./chatTimeouts";

const FOURTH_WALL_PATTERNS: RegExp[] = [
  /\bmarvel cinematic universe\b/i,
  /\bthe mcu\b/i,
  /\bin the (?:movies|films|comics|franchise)\b/i,
];

/**
 * One short regenerate. Well under the normal local extra-generation cap
 * so a failed backup cannot run a full decode.
 */
export const FOURTH_WALL_RETRY_MAX_TOKENS = 32;

/**
 * Skip the backup once the turn has used half of the 90s first-token budget.
 * The first reply is kept.
 */
export const FOURTH_WALL_RETRY_ELAPSED_LIMIT_MS = LLM_LOCAL_FIRST_TOKEN_MS / 2;

/** True when the companion's reply names the world as a film, comic, or franchise. */
export function isFourthWallReply(reply: unknown): boolean {
  const text = String(reply ?? "").trim();
  if (!text) return false;
  return FOURTH_WALL_PATTERNS.some((pattern) => pattern.test(text));
}

/** False once the turn has already spent a large share of its time budget. */
export function fourthWallRetryAllowed(elapsedMs: number): boolean {
  const elapsed = Number(elapsedMs);
  if (!Number.isFinite(elapsed) || elapsed < 0) return false;
  return elapsed < FOURTH_WALL_RETRY_ELAPSED_LIMIT_MS;
}

/**
 * Appended to the final user turn on the one regenerate. Not part of the
 * cached system prefix. Uses the same sentences as the stable persona.
 */
export function inWorldRetryReminder(name: string | null | undefined): string {
  const who = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const stay = who ? `Stay ${who}. ` : "";
  return `${stay}You live in your own world. The person talking to you has stepped into it and is here with you now. Speak in first person about your life and places as things you know firsthand. Never mention films, comics, a franchise, or a story.`;
}
