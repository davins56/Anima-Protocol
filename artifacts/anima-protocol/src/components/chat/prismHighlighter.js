// @ts-check
/**
 * Prism-based token highlighter, loaded only when a bubble contains a fenced
 * code block. Keep language imports in dependency order (Prism attaches them
 * to a shared instance).
 */
import { createElement } from "react";
import Prism from "prismjs";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-go";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-java";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-php";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-graphql";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-diff";
import "prismjs/components/prism-toml";

const ALIASES = {
  js: "javascript",
  javascript: "javascript",
  ts: "typescript",
  typescript: "typescript",
  jsx: "jsx",
  tsx: "tsx",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  bash: "bash",
  json: "json",
  css: "css",
  html: "markup",
  xml: "markup",
  svg: "markup",
  markup: "markup",
  md: "markdown",
  markdown: "markdown",
  rs: "rust",
  rust: "rust",
  go: "go",
  golang: "go",
  sql: "sql",
  yml: "yaml",
  yaml: "yaml",
  java: "java",
  c: "c",
  h: "c",
  cpp: "cpp",
  "c++": "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  cs: "csharp",
  csharp: "csharp",
  php: "php",
  rb: "ruby",
  ruby: "ruby",
  swift: "swift",
  kt: "kotlin",
  kotlin: "kotlin",
  graphql: "graphql",
  gql: "graphql",
  docker: "docker",
  dockerfile: "docker",
  diff: "diff",
  patch: "diff",
  toml: "toml",
};

/**
 * @param {string} language
 * @returns {string | null}
 */
export function resolvePrismLanguage(language) {
  if (!language) return null;
  const key = String(language).trim().toLowerCase();
  return ALIASES[key] || (Prism.languages[key] ? key : null);
}

/**
 * Turn source into React spans (no HTML injection). Returns null when the
 * language is unknown so the caller can keep the plain text.
 * @param {string} code
 * @param {string} language
 * @returns {import("react").ReactNode[] | null}
 */
export function highlightToElements(code, language) {
  const lang = resolvePrismLanguage(language);
  if (!lang || !Prism.languages[lang]) return null;
  const tokens = Prism.tokenize(code, Prism.languages[lang]);
  return renderTokens(tokens, "t");
}

/**
 * @param {import("prismjs").TokenStream} tokens
 * @param {string} prefix
 * @returns {import("react").ReactNode[]}
 */
function renderTokens(tokens, prefix) {
  return tokens.map((token, i) => {
    const key = `${prefix}-${i}`;
    if (typeof token === "string") {
      return createElement("span", { key }, token);
    }
    const content = Array.isArray(token.content)
      ? renderTokens(token.content, key)
      : token.content;
    return createElement("span", { key, className: `token token-${token.type}` }, content);
  });
}
