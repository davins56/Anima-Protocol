/**
 * DeepSeek R1 (Workers AI `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`)
 * wraps chain-of-thought in `<think>…</think>`. Production often returns
 * unclosed `<think>`-only text with no post-think answer. Waiting for
 * `</think>` hides the only usable tokens and leaves an empty bubble.
 */

const CLOSED_THINK_RE = /<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi;
const UNCLOSED_THINK_RE = /<think(?:ing)?\b[^>]*>[\s\S]*$/i;
const INNER_THINK_RE = /<think(?:ing)?\b[^>]*>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi;
const HAS_THINK_RE = /<think(?:ing)?\b/i;

export function hasThinkMarkup(raw: string): boolean {
  return HAS_THINK_RE.test(String(raw ?? ""));
}

export function visibleAssistantReply(
  raw: string,
  opts: { allowThinkFallback?: boolean } = {},
): string {
  const text = String(raw ?? "");
  if (!HAS_THINK_RE.test(text)) return text;
  const remainder = text.replace(CLOSED_THINK_RE, "").replace(UNCLOSED_THINK_RE, "");
  if (remainder.trim()) {
    return remainder.replace(/^\s+/, "");
  }
  if (opts.allowThinkFallback === false) return "";
  const inners: string[] = [];
  for (const match of text.matchAll(INNER_THINK_RE)) {
    const inner = String(match[1] ?? "").trim();
    if (inner) inners.push(inner);
  }
  return inners.join("\n\n");
}

/** Canonical visible text for a finished turn. Never waits for `</think>`. */
export function finalizeAssistantReply(
  ...parts: Array<string | null | undefined>
): string {
  for (const part of parts) {
    const visible = visibleAssistantReply(part || "", {
      allowThinkFallback: true,
    }).trim();
    if (visible) return visible;
  }
  return "";
}

const SENTENCE_END_RE = /[.!?…]["'”’)\]*_~]*(?=\s|$)/g;
const COMPLETE_SENTENCE_RE = /[.!?…]["'”’)\]*_~]*$/;

/**
 * Lone `*action*` spans. Bold `**labels**` are not action lines.
 * `closeAt` is the index just after the last closed action.
 */
function scanActionMarkers(value: string): { closeAt: number; unclosed: boolean } {
  let i = 0;
  let closeAt = -1;
  let unclosed = false;
  while (i < value.length) {
    if (value[i] !== "*") {
      i += 1;
      continue;
    }
    if (value[i + 1] === "*") {
      i += 2;
      continue;
    }
    let j = i + 1;
    while (j < value.length && value[j] !== "*") j += 1;
    if (j >= value.length || value[j + 1] === "*") {
      unclosed = true;
      break;
    }
    closeAt = j + 1;
    unclosed = false;
    i = j + 1;
  }
  return { closeAt, unclosed };
}

/**
 * A reply cut off by the token cap or a stall ends mid-word
 * ("...the quiet, undist"). Keep the longer of the last finished sentence
 * or the last closed `*action*`. If neither exists, keep the text and close
 * an open action so a lone `*` is not left hanging.
 */
export function trimToLastCompleteSentence(text: string): string {
  const value = String(text ?? "").trimEnd();
  if (!value || COMPLETE_SENTENCE_RE.test(value)) return value;
  let sentenceEnd = -1;
  for (const match of value.matchAll(SENTENCE_END_RE)) {
    const index = match.index ?? 0;
    // "Mr. Smith" is not a sentence end.
    if (/\b(?:Mr|Mrs|Ms|Dr|St|Jr|Sr|vs|etc|e\.g|i\.e)$/i.test(value.slice(0, index))) continue;
    sentenceEnd = index + match[0].length;
  }
  const action = scanActionMarkers(value);
  const cut = Math.max(sentenceEnd, action.closeAt);
  if (cut > 0) return value.slice(0, cut).trimEnd();
  if (action.unclosed) return `${value}*`;
  return value;
}

/** Token-cap, stall, and interrupted-stream cuts share one trim. A stopped-early fragment is left alone. */
export function settleCappedReply(
  text: string,
  meta: {
    timedOut?: boolean;
    finishReason?: string | null;
    stoppedEarly?: boolean;
    interrupted?: boolean;
  } = {},
): string {
  if (meta.stoppedEarly && !meta.interrupted) return text;
  if (meta.timedOut || meta.interrupted || meta.finishReason === "length") {
    return trimToLastCompleteSentence(text);
  }
  return text;
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
    push(delta: string): string {
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
    finish(): { visible: string; emitted: string } {
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
