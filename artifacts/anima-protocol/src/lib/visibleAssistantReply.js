/**
 * DeepSeek R1 wraps chain-of-thought in `<think>…</think>`. Production often
 * returns unclosed `<think>`-only text with no post-think answer. Waiting for
 * `</think>` hides the only usable tokens and leaves an empty bubble.
 */

const CLOSED_THINK_RE = /<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi;
const UNCLOSED_THINK_RE = /<think(?:ing)?\b[^>]*>[\s\S]*$/i;
const INNER_THINK_RE = /<think(?:ing)?\b[^>]*>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi;
const HAS_THINK_RE = /<think(?:ing)?\b/i;

export function hasThinkMarkup(raw) {
  return HAS_THINK_RE.test(String(raw ?? ""));
}

export function visibleAssistantReply(raw, opts = {}) {
  const text = String(raw ?? "");
  if (!HAS_THINK_RE.test(text)) return text;
  const remainder = text.replace(CLOSED_THINK_RE, "").replace(UNCLOSED_THINK_RE, "");
  if (remainder.trim()) {
    return remainder.replace(/^\s+/, "");
  }
  if (opts.allowThinkFallback === false) return "";
  const inners = [];
  for (const match of text.matchAll(INNER_THINK_RE)) {
    const inner = String(match[1] ?? "").trim();
    if (inner) inners.push(inner);
  }
  return inners.join("\n\n");
}

const SENTENCE_END_RE = /[.!?…]["'”’)\]*_~]*(?=\s|$)/g;
const NAMED_HONORIFIC_RE =
  /\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|e\.g|i\.e)$/i;
const INITIALISM_RE = /(?:[A-Za-z]\.)+[A-Za-z]$/;

/**
 * Cut a dropped stream back to the last finished sentence.
 * A fragment with no sentence end is kept so Retry can still replace it.
 * `Dr.` is not a sentence end. `U.S.` is one only when nothing follows it.
 */
export function trimToLastFullSentence(text) {
  const value = String(text ?? "").trimEnd();
  if (!value) return value;
  let sentenceEnd = -1;
  for (const match of value.matchAll(SENTENCE_END_RE)) {
    const index = match.index ?? 0;
    const before = value.slice(0, index);
    const rest = value.slice(index + match[0].length).trim();
    if (NAMED_HONORIFIC_RE.test(before)) continue;
    if (INITIALISM_RE.test(before) && rest) continue;
    sentenceEnd = index + match[0].length;
  }
  if (sentenceEnd > 0) return value.slice(0, sentenceEnd).trimEnd();
  return value;
}

/** Canonical visible text for a finished turn. Never waits for `</think>`. */
export function finalizeAssistantReply(...parts) {
  for (const part of parts) {
    const visible = visibleAssistantReply(part || "", {
      allowThinkFallback: true,
    }).trim();
    if (visible) return visible;
  }
  return "";
}

export function createVisibleReplyFilter() {
  let raw = "";
  let emittedVisible = "";

  // Unclosed `<think>` is the production DeepSeek reply. Surface inner text
  // as it arrives — do not wait for a closing tag that never comes.
  const peek = () => visibleAssistantReply(raw, { allowThinkFallback: true });
  const peekAnswer = () =>
    visibleAssistantReply(raw, { allowThinkFallback: false });

  return {
    peek,
    peekAnswer,
    hasPostThinkAnswer: () => peekAnswer().trim().length > 0,
    push(delta) {
      raw += String(delta ?? "");
      const next = peek();
      if (next.startsWith(emittedVisible)) {
        const extra = next.slice(emittedVisible.length);
        emittedVisible = next;
        return extra;
      }
      // Remainder replaced think-fallback once `</think>` + answer arrived.
      // Do not emit a non-prefix extra — SSE clients concatenate chunks.
      // finish() / done.content carry the replacement.
      return "";
    },
    finish() {
      const next = finalizeAssistantReply(raw);
      let extra = "";
      if (next.startsWith(emittedVisible)) {
        extra = next.slice(emittedVisible.length);
      } else if (next && !emittedVisible) {
        extra = next;
      } else if (next !== emittedVisible) {
        extra = next;
      }
      emittedVisible = next;
      return { visible: next, emitted: extra };
    },
  };
}
