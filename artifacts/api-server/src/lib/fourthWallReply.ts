/**
 * Rare backup for a companion reply that narrates its world from outside.
 * The user's own message is never passed here. A 0.5B CPU turn has a 90s
 * budget and a queue behind it, so this fires only on a clear franchise
 * phrase, and only when most of that budget is still left.
 */

import { LLM_LOCAL_FIRST_TOKEN_MS } from "./chatTimeouts";
import { IN_WORLD_PRESENCE, IN_WORLD_VOICE } from "./promptBuilder";

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

const PAST_NARRATION_VERB =
  "found|felt|smiled|turned|looked|walked|stood|sat|said|whispered|sighed|watched|stepped|reached|noticed|realized|realised|knew|saw|heard|thought|wondered|glanced|nodded|frowned|laughed|paused|stopped|moved|leaned|leant|stared|gazed|closed|opened|took|gave|held|kept|remained|became|began|started|continued|crossed|entered|left|ran|came|went|asked|answered|replied|murmured|shook|raised|lowered|pressed|pulled|pushed|drew|caught|let|made|had|was|were";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function openingSentence(reply: string): string {
  const trimmed = reply.trim();
  const split = trimmed.split(/(?<=[.!?…])\s+/);
  return (split[0] || trimmed).trim();
}

/**
 * Group replies open with `**Name:**`. Action lines open with one `*`.
 * Drop those before the name check. One label, then one action mark.
 */
function narrationOpening(reply: string): string {
  let text = reply.trim().replace(/^\*\*[^*\n]+?:\*\*\s*/, "");
  if (text.startsWith("*") && !text.startsWith("**")) {
    text = text.slice(1).trimStart();
  }
  return openingSentence(text);
}

/**
 * The opening sentence starts with the companion's own name and then narrates
 * her in the third person ("Natasha Romanoff found herself"). A later mention
 * ("people call me Natasha") is not this.
 */
export function isThirdPersonSelfNarration(
  reply: unknown,
  name: string | null | undefined,
): boolean {
  const who = String(name || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const text = String(reply ?? "").trim();
  if (!who || who.length < 2 || !text) return false;
  const sentence = narrationOpening(text);
  const first = who.split(/\s+/)[0] || "";
  const names = [who];
  if (first.length >= 2 && first.toLowerCase() !== who.toLowerCase()) names.push(first);
  const pattern = new RegExp(
    `^(?:${names.map(escapeRegExp).join("|")})\\s+(?:found\\s+(?:herself|himself|themselves)|${PAST_NARRATION_VERB})\\b`,
    "i",
  );
  return pattern.test(sentence);
}

/**
 * True when the companion's reply names the world as a film, comic, or
 * franchise, or opens by narrating herself in the third person.
 * `name` is the companion's own name. Omit it and only the franchise phrases match.
 */
export function isFourthWallReply(reply: unknown, name?: string | null): boolean {
  const text = String(reply ?? "").trim();
  if (!text) return false;
  if (FOURTH_WALL_PATTERNS.some((pattern) => pattern.test(text))) return true;
  return isThirdPersonSelfNarration(text, name);
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
  return `${stay}${IN_WORLD_PRESENCE} ${IN_WORLD_VOICE}`;
}
