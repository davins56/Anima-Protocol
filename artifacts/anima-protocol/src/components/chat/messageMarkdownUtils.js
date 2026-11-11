// @ts-check

/**
 * Shared helpers for GitHub-flavored markdown in chat bubbles.
 * Keep roleplay *action* styling in sync with renderItalicText.
 */
export const ROLEPLAY_ACTION_CLASS = "text-primary/70 opacity-75";

/**
 * Allow only http(s), mailto, tel, and relative/hash URLs.
 * Rejects javascript:, data:, vbscript:, file:, and protocol-relative URLs.
 * @param {unknown} href
 * @returns {string | undefined}
 */
export function sanitizeHref(href) {
  if (href == null) return undefined;
  const trimmed = String(href).trim();
  if (!trimmed) return undefined;
  if (/[\u0000-\u001F\u007F]/.test(trimmed)) return undefined;

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("//")) return undefined;

  const schemeMatch = lower.match(/^([a-z][a-z0-9+.-]*):/);
  if (schemeMatch) {
    if (schemeMatch[1] === "https" || schemeMatch[1] === "http" || schemeMatch[1] === "mailto" || schemeMatch[1] === "tel") {
      return trimmed;
    }
    return undefined;
  }

  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    !trimmed.includes(":")
  ) {
    return trimmed;
  }
  return undefined;
}

/**
 * True when the text contains a fenced (or likely indented) code block.
 * Used to lazy-load the syntax highlighter only when needed.
 * @param {string} text
 */
export function messageHasCodeFence(text) {
  if (!text) return false;
  return /(^|\n)[ \t]{0,3}(`{3,}|~{3,})/.test(text);
}

/**
 * True when the text looks like it contains TeX math delimiters.
 * Used to lazy-load KaTeX (and its CSS) only when needed.
 * @param {string} text
 */
export function messageHasMath(text) {
  if (!text) return false;
  if (text.includes("$$") || text.includes("\\(") || text.includes("\\[")) return true;
  // Closed inline $...$ on one line, not a lone dollar amount like $5.
  return /(^|[^\\$])\$[^\s$][^$\n]*\$/.test(text);
}

/**
 * Close unclosed fenced code blocks and display-math delimiters so a
 * mid-stream (or accidentally unclosed) message still parses as structured
 * markdown instead of leaking raw fence markers into the rest of the bubble.
 * Unclosed inline $ or \( are left alone so a trailing "$" does not swallow
 * the rest of the text as math.
 * @param {string} text
 * @returns {string}
 */
export function prepareStreamingMarkdown(text) {
  if (!text) return text;

  const openFence = findOpenFence(text);
  let out = text;
  if (openFence) {
    if (!out.endsWith("\n")) out += "\n";
    out += openFence.char.repeat(openFence.len);
  }

  const display = findUnclosedDisplayMath(out);
  if (display) out += display.closer;
  return out;
}

/**
 * remark-rehype handlers that turn remark-math nodes into elements we render
 * with a lazily loaded KaTeX component (no rehype-katex, so katex stays out
 * of the Chat chunk until a message actually has math).
 */
export const remarkRehypeMathHandlers = {
  /**
   * @param {unknown} _state
   * @param {{ value?: string }} node
   */
  inlineMath(_state, node) {
    return {
      type: "element",
      tagName: "span",
      properties: {
        className: ["md-math", "md-math-inline"],
        dataMath: node.value || "",
      },
      children: [{ type: "text", value: node.value || "" }],
    };
  },
  /**
   * @param {unknown} _state
   * @param {{ value?: string }} node
   */
  math(_state, node) {
    return {
      type: "element",
      tagName: "div",
      properties: {
        className: ["md-math", "md-math-display"],
        dataMath: node.value || "",
      },
      children: [{ type: "text", value: node.value || "" }],
    };
  },
};

/**
 * @param {string} text
 * @returns {{ char: string, len: number } | null}
 */
function findOpenFence(text) {
  const lines = text.split("\n");
  /** @type {{ char: string, len: number } | null} */
  let fence = null;
  for (const line of lines) {
    const m = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (!m) continue;
    const marker = m[1];
    const char = marker[0];
    const len = marker.length;
    const rest = m[2];
    if (!fence) {
      fence = { char, len };
    } else if (char === fence.char && len >= fence.len && rest.trim() === "") {
      fence = null;
    }
  }
  return fence;
}

/**
 * @param {string} text
 * @returns {{ closer: string } | null}
 */
function findUnclosedDisplayMath(text) {
  let i = 0;
  const n = text.length;
  /** @type {string | null} */
  let opened = null;
  let atLineStart = true;

  while (i < n) {
    const ch = text[i];

    if (atLineStart && !opened) {
      const fence = startsFence(text, i);
      if (fence) {
        const closeAt = findClosingFence(text, fence.end, fence.char, fence.len);
        if (closeAt < 0) return null;
        i = closeAt;
        atLineStart = true;
        continue;
      }
    }

    if (opened === "$$") {
      if (ch === "$" && text[i + 1] === "$") {
        opened = null;
        i += 2;
        atLineStart = false;
        continue;
      }
    } else if (opened === "\\[") {
      if (ch === "\\" && text[i + 1] === "]") {
        opened = null;
        i += 2;
        atLineStart = false;
        continue;
      }
    } else {
      if (ch === "$" && text[i + 1] === "$") {
        opened = "$$";
        i += 2;
        atLineStart = false;
        continue;
      }
      if (ch === "\\" && text[i + 1] === "[") {
        opened = "\\[";
        i += 2;
        atLineStart = false;
        continue;
      }
      // Skip inline $...$ and \(...\) so we don't treat them as display.
      if (ch === "$") {
        const end = text.indexOf("$", i + 1);
        if (end !== -1 && !text.slice(i + 1, end).includes("\n")) {
          i = end + 1;
          atLineStart = false;
          continue;
        }
      }
      if (ch === "\\" && text[i + 1] === "(") {
        const end = text.indexOf("\\)", i + 2);
        if (end !== -1) {
          i = end + 2;
          atLineStart = false;
          continue;
        }
      }
    }

    atLineStart = ch === "\n";
    i += 1;
  }

  if (opened === "$$") return { closer: "$$" };
  if (opened === "\\[") return { closer: "\\]" };
  return null;
}

/**
 * @param {string} text
 * @param {number} i
 */
function startsFence(text, i) {
  let j = i;
  let spaces = 0;
  while (text[j] === " " && spaces < 3) {
    j += 1;
    spaces += 1;
  }
  const char = text[j];
  if (char !== "`" && char !== "~") return null;
  let len = 0;
  while (text[j + len] === char) len += 1;
  if (len < 3) return null;
  return { char, len, end: j + len };
}

/**
 * @param {string} text
 * @param {number} from
 * @param {string} char
 * @param {number} len
 */
function findClosingFence(text, from, char, len) {
  let i = from;
  // Skip the rest of the opening fence line
  while (i < text.length && text[i] !== "\n") i += 1;
  i += 1;
  while (i < text.length) {
    const lineStart = i;
    const fence = startsFence(text, lineStart);
    if (fence && fence.char === char && fence.len >= len) {
      let k = fence.end;
      while (k < text.length && text[k] !== "\n" && /\s/.test(text[k])) k += 1;
      if (k >= text.length || text[k] === "\n") {
        return k < text.length ? k + 1 : k;
      }
    }
    while (i < text.length && text[i] !== "\n") i += 1;
    i += 1;
  }
  return -1;
}
