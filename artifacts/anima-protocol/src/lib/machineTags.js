// @ts-check
/**
 * Chunk-safe stripping of machine tags from companion replies (#765, ANIMA_EMOTIONS).
 *
 * Only instrumentation is removed:
 *   - `[EMOTION: …]` affect tags
 *   - `[[ … ]]` stage markers (#763, e.g. `[[exit]]`, `[[enter:Serenity]]`)
 * Ordinary emotional language, quotes, brackets and emoji are kept.
 *
 * The functions are stateless over the accumulated text, so the result does
 * not depend on where the stream was chunked: `stripMachineTagsStreaming`
 * holds back a trailing fragment that could still become a tag, and
 * `stripMachineTags` (end of stream) flushes an unclosed fragment as text,
 * matching the server rule on #765. Stored text uses `stripMachineTags`, so
 * stored and streamed text match.
 */

/** Longest tag we hold back while streaming; longer brackets are plain text. */
export const MAX_MACHINE_TAG_LENGTH = 120;

const EMOTION_TAG = String.raw`\[\s*EMOTION\s*:[^\]\n]{0,${MAX_MACHINE_TAG_LENGTH}}\]`;
const STAGE_TAG = String.raw`\[\[[^\[\]\n]{0,${MAX_MACHINE_TAG_LENGTH}}\]\]`;
const TAG = `(?:${EMOTION_TAG}|${STAGE_TAG})`;
// A tag alone at the start of a line takes the spaces after it too.
const LINE_START_TAG_RE = new RegExp(String.raw`(^|\n)[ \t]*${TAG}[ \t]*`, "gi");
// Inline, a tag takes the spaces before it ("Hi [EMOTION: x] there" -> "Hi there").
const INLINE_TAG_RE = new RegExp(String.raw`[ \t]*${TAG}`, "gi");

const EMOTION_PREFIX = "[EMOTION:";

/**
 * Could `fragment` (which starts with "[") still grow into a machine tag?
 *
 * @param {string} fragment
 */
function couldBecomeTag(fragment) {
  if (fragment.length > MAX_MACHINE_TAG_LENGTH + 4) return false;
  if (fragment.includes("\n")) return false;
  if (fragment.startsWith("[[")) {
    // Still open: no "]]" yet and no nested "[".
    const body = fragment.slice(2);
    if (body.includes("[")) return false;
    if (body.endsWith("]")) return !body.slice(0, -1).includes("]");
    return !body.includes("]");
  }
  if (fragment === "[") return true;
  if (fragment.includes("]")) return false;
  // Compare against "[EMOTION:" ignoring case and spaces after "[" / before ":".
  const compact = fragment.replace(/^\[\s*/, "[").replace(/\s*:/, ":");
  const upper = compact.toUpperCase();
  if (upper.length <= EMOTION_PREFIX.length) return EMOTION_PREFIX.startsWith(upper);
  return upper.startsWith(EMOTION_PREFIX);
}

/**
 * Remove complete machine tags. Unclosed fragments are kept as text.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripMachineTags(text) {
  const value = String(text ?? "");
  if (!value.includes("[")) return value;
  return value.replace(LINE_START_TAG_RE, "$1").replace(INLINE_TAG_RE, "");
}

/**
 * Mid-stream view: strip complete tags and hold back a trailing fragment
 * that could still become one.
 *
 * @param {string} text accumulated visible text so far
 * @returns {string}
 */
export function stripMachineTagsStreaming(text) {
  const value = String(text ?? "");
  if (!value.includes("[")) return value;
  // Find the earliest "[" in the tail that could still open a tag. Search a
  // bounded window so a long reply stays cheap.
  const windowStart = Math.max(0, value.length - (MAX_MACHINE_TAG_LENGTH + 4));
  let cut = -1;
  for (let i = value.indexOf("[", windowStart); i !== -1; i = value.indexOf("[", i + 1)) {
    const fragment = value.slice(i);
    // A complete tag here is handled by stripMachineTags below.
    if (new RegExp(`^${TAG}`, "i").test(fragment)) continue;
    if (couldBecomeTag(fragment)) {
      cut = i;
      break;
    }
  }
  const head = cut === -1 ? value : value.slice(0, cut);
  return stripMachineTags(head);
}
