// Tiny zero-dependency syntax highlighter for the Codespace editor overlay.
//
// It tokenizes code and safely escapes all inputs so HTML tags cannot be injected.
// Output contains only safe <span class="..."> elements wrapping escaped text.

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "new", "class", "extends",
  "super", "this", "typeof", "instanceof", "in", "of", "try", "catch",
  "finally", "throw", "async", "await", "yield", "import", "export", "from",
  "default", "null", "undefined", "true", "false", "void", "delete", "static",
  "get", "set"
]);

const PY_KEYWORDS = new Set([
  "def", "return", "if", "elif", "else", "for", "while", "break", "continue",
  "class", "import", "from", "as", "try", "except", "finally", "raise", "with",
  "lambda", "pass", "global", "nonlocal", "yield", "async", "await", "None",
  "True", "False", "and", "or", "not", "in", "is", "print"
]);

function highlightGeneric(src, keywordSet) {
  const tokenRe = /(?:\/\*[\s\S]*?\*\/|\/\/[^\n]*|#[^\n]*)|(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(?:\b\d+(?:\.\d+)?\b)|(?:\b[A-Za-z_$][\w$]*\b)/g;

  let out = "";
  let last = 0;
  let m;
  while ((m = tokenRe.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("/*") || token.startsWith("//") || token.startsWith("#")) {
      out += `<span class="tok-com">${escapeHtml(token)}</span>`;
    } else if (token.startsWith('"') || token.startsWith("'") || token.startsWith("`")) {
      out += `<span class="tok-str">${escapeHtml(token)}</span>`;
    } else if (/^\d/.test(token)) {
      out += `<span class="tok-num">${escapeHtml(token)}</span>`;
    } else if (keywordSet.has(token)) {
      out += `<span class="tok-kw">${escapeHtml(token)}</span>`;
    } else {
      out += escapeHtml(token);
    }
    last = tokenRe.lastIndex;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

function highlightCss(src) {
  const tokenRe = /(\/\*[\s\S]*?\*\/)|([\w-]+)(\s*:)|([.#][\w-]+)/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = tokenRe.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    if (m[1]) {
      out += `<span class="tok-com">${escapeHtml(m[1])}</span>`;
    } else if (m[2]) {
      out += `<span class="tok-prop">${escapeHtml(m[2])}</span>` + escapeHtml(m[3]);
    } else if (m[4]) {
      out += `<span class="tok-kw">${escapeHtml(m[4])}</span>`;
    }
    last = tokenRe.lastIndex;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

function highlightHtml(src) {
  const tokenRe = /(<!--[\s\S]*?-->)|(<\/?[a-zA-Z0-9-]+)|(\b[a-zA-Z0-9-]+)(\s*=\s*)("[^"]*"|'[^']*'|[^\s>]+)/g;
  let out = "";
  let last = 0;
  let m;
  while ((m = tokenRe.exec(src))) {
    out += escapeHtml(src.slice(last, m.index));
    if (m[1]) {
      out += `<span class="tok-com">${escapeHtml(m[1])}</span>`;
    } else if (m[2]) {
      if (m[2].startsWith("</")) {
        out += "&lt;/<span class=\"tok-kw\">" + escapeHtml(m[2].slice(2)) + "</span>";
      } else {
        out += "&lt;<span class=\"tok-kw\">" + escapeHtml(m[2].slice(1)) + "</span>";
      }
    } else if (m[3]) {
      out += `<span class="tok-prop">${escapeHtml(m[3])}</span>${escapeHtml(m[4])}<span class="tok-str">${escapeHtml(m[5])}</span>`;
    }
    last = tokenRe.lastIndex;
  }
  out += escapeHtml(src.slice(last));
  return out;
}

export function highlight(code, language) {
  const src = code || "";
  switch (language) {
    case "python":
      return highlightGeneric(src, PY_KEYWORDS);
    case "css":
      return highlightCss(src);
    case "html":
      return highlightHtml(src);
    case "json":
    case "markdown":
      return escapeHtml(src);
    default:
      return highlightGeneric(src, JS_KEYWORDS);
  }
}

export default highlight;
