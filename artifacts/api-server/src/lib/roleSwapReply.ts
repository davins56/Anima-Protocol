/**
 * A 0.5B model sometimes opens by handing the companion's name to the human
 * ("You are Natasha Romanoff…") and retelling her past as theirs.
 * One short regenerate, local only, shares the turn's single extra generation.
 * The check is the opening only, so it can stop a stream in the first few tokens.
 */

const FIRST_NAME_STOP = new Set([
  "the",
  "and",
  "you",
  "she",
  "he",
  "her",
  "his",
  "they",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeName(value: string | null | undefined): string {
  return String(value || "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Drop one speaker label, one bracketed beat, or one italic action so
 * "[Pause] You are Natasha" still counts as the opening.
 */
function roleSwapOpening(reply: string): string {
  let text = reply.trim().replace(/^\*\*[^*\n]+?:\*\*\s*/, "");
  text = text.replace(/^\[[^\]\n]{1,48}\]\s*/, "");
  if (text.startsWith("*") && !text.startsWith("**")) {
    const end = text.indexOf("*", 1);
    if (end > 1 && end <= 80) text = text.slice(end + 1);
    else text = text.slice(1);
  }
  return text.trim();
}

/**
 * True when the reply begins by addressing the human as the companion.
 * "You are not <name>" and a later mention of the name do not match.
 */
export function isRoleSwapReply(reply: unknown, name: string | null | undefined): boolean {
  const who = sanitizeName(name);
  const text = String(reply ?? "").trim();
  if (!who || who.length < 2 || !text) return false;
  const sentence = roleSwapOpening(text);
  const first = who.split(/\s+/)[0] || "";
  const names = [who];
  if (
    first.length >= 3 &&
    first.toLowerCase() !== who.toLowerCase() &&
    !FIRST_NAME_STOP.has(first.toLowerCase())
  ) {
    names.push(first);
  }
  names.sort((a, b) => b.length - a.length);
  const pattern = new RegExp(
    `^you(?:\\s+are(?!n['’]t)|'re|’re)\\s+(?!not\\b)(?:${names.map(escapeRegExp).join("|")})\\b(?!['’])`,
    "i",
  );
  return pattern.test(sentence);
}

/**
 * Appended to the final user turn on the one regenerate. Not part of the
 * cached system prefix. Does not contain "You are <name>", which is the
 * line the small model copies.
 */
export function roleSwapRetryReminder(name: string | null | undefined): string {
  const who = sanitizeName(name);
  if (!who) {
    return "Answer in your own first person. The human is a guest, not you. Do not give them your name or your past.";
  }
  return `Answer in your own first person as ${who}. The human is a guest, not ${who}. Do not give them your name or your past.`;
}
