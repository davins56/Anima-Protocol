// Tiny zero-dependency syntax highlighter for the Codespace editor overlay.
//
// It tokenizes a handful of languages with regexes and returns HTML with
// colored <span>s (input is HTML-escaped first, so it is safe to inject). This
// is intentionally lightweight — enough to make code readable without pulling in
// a heavy editor/highlighter dependency.

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const JS_KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|import|export|from|default|null|undefined|true|false|void|delete|static|get|set)\b/g;

const PY_KEYWORDS =
  /\b(def|return|if|elif|else|for|while|break|continue|class|import|from|as|try|except|finally|raise|with|lambda|pass|global|nonlocal|yield|async|await|None|True|False|and|or|not|in|is|print)\b/g;

// Order matters: comments and strings are matched first so keyword/number rules
// don't bleed into them. We do a single pass with a combined regex.
function highlightGeneric(src, keywordRe) {
  const tokenRe = new RegExp(
    [
      "(/\\*[\\s\\S]*?\\*/|//[^\\n]*|#[^\\n]*)", // comments (block, //, #)
      "(\"(?:[^\"\\\\]|\\\\.)*\"|'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)", // strings
      "(\\b\\d+(?:\\.\\d+)?\\b)", // numbers
    ].join("|"),
    "g",
  );

  let out = "";
  let last = 0;
  let m;
  while ((m = tokenRe.exec(src))) {
    const before = src.slice(last, m.index);
    out += escapeHtml(before).replace(
      keywordRe,
      '<span class="tok-kw">$&</span>',
    );
    if (m[1]) out += `<span class="tok-com">${escapeHtml(m[1])}</span>`;
    else if (m[2]) out += `<span class="tok-str">${escapeHtml(m[2])}</span>`;
    else if (m[3]) out += `<span class="tok-num">${escapeHtml(m[3])}</span>`;
    last = tokenRe.lastIndex;
  }
  out += escapeHtml(src.slice(last)).replace(
    keywordRe,
    '<span class="tok-kw">$&</span>',
  );
  return out;
}

function highlightCss(src) {
  return escapeHtml(src)
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-com">$1</span>')
    .replace(/([\w-]+)(\s*:)/g, '<span class="tok-prop">$1</span>$2')
    .replace(/([.#][\w-]+)/g, '<span class="tok-kw">$1</span>');
}

function highlightHtml(src) {
  return escapeHtml(src)
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-com">$1</span>')
    .replace(/(&lt;\/?)([\w-]+)/g, '$1<span class="tok-kw">$2</span>')
    .replace(/([\w-]+)(=)(&quot;[^&]*&quot;|"[^"]*")/g,
      '<span class="tok-prop">$1</span>$2<span class="tok-str">$3</span>');
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
