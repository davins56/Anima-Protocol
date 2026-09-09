/**
 * DeepSeek R1 (Workers AI `@cf/deepseek-ai/deepseek-r1-distill-qwen-32b`)
 * wraps chain-of-thought in `<think>…</think>`. Stripping those tags without
 * a fallback turns a think-only completion into an empty assistant bubble.
 */

const CLOSED_THINK_RE = /<think(?:ing)?\b[^>]*>[\s\S]*?<\/think(?:ing)?>/gi;
const UNCLOSED_THINK_RE = /<think(?:ing)?\b[^>]*>[\s\S]*$/i;
const INNER_THINK_RE = /<think(?:ing)?\b[^>]*>([\s\S]*?)(?:<\/think(?:ing)?>|$)/gi;
const HAS_THINK_RE = /<think(?:ing)?\b/i;

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

export function createVisibleReplyFilter() {
  let raw = "";
  let emittedVisible = "";

  const peek = () => visibleAssistantReply(raw, { allowThinkFallback: false });

  return {
    peek,
    push(delta: string): string {
      raw += String(delta ?? "");
      const next = peek();
      if (next.startsWith(emittedVisible)) {
        const extra = next.slice(emittedVisible.length);
        emittedVisible = next;
        return extra;
      }
      return "";
    },
    finish(): { visible: string; emitted: string } {
      const next = visibleAssistantReply(raw, { allowThinkFallback: true });
      let extra = "";
      if (next.startsWith(emittedVisible)) {
        extra = next.slice(emittedVisible.length);
      } else if (next && !emittedVisible) {
        extra = next;
      } else if (next !== emittedVisible) {
        extra = next;
      }
      emittedVisible = next;
      return { visible: next.trim(), emitted: extra };
    },
  };
}
