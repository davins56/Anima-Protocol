// @ts-check
import { lazy, memo, Suspense, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import MessageCodeBlock from "./MessageCodeBlock";
import {
  ROLEPLAY_ACTION_CLASS,
  prepareStreamingMarkdown,
  remarkRehypeMathHandlers,
  sanitizeHref,
} from "./messageMarkdownUtils";
import "./messageMarkdown.css";

const LazyMessageMath = lazy(() => import("./MessageMath.jsx"));

const REMARK_PLUGINS = [remarkGfm, remarkMath];
const REHYPE_OPTIONS = { handlers: remarkRehypeMathHandlers };

/**
 * @param {unknown} className
 * @returns {string[]}
 */
function classList(className) {
  if (!className) return [];
  if (Array.isArray(className)) return className.flatMap(classList);
  return String(className).split(/\s+/).filter(Boolean);
}

/**
 * @param {Record<string, unknown>} props
 */
function mathExprFromProps(props) {
  if (props["data-math"] != null) return String(props["data-math"]);
  if (props.dataMath != null) return String(props.dataMath);
  return nodeText(props.children);
}

/**
 * @param {unknown} children
 * @returns {string}
 */
function nodeText(children) {
  if (children == null || children === false) return "";
  if (typeof children === "string" || typeof children === "number") return String(children);
  if (Array.isArray(children)) return children.map(nodeText).join("");
  if (typeof children === "object" && children && "props" in children) {
    return nodeText(/** @type {{ props: { children?: unknown } }} */ (children).props.children);
  }
  return "";
}

/**
 * @param {unknown} className
 * @param {string} flag
 */
function hasClass(className, flag) {
  return classList(className).includes(flag);
}

function MathFallback({ expr, display }) {
  if (display) {
    return (
      <div
        className="md-math-display my-1.5 overflow-x-auto font-mono text-primary/70"
        data-testid="message-math-fallback"
      >
        {expr}
      </div>
    );
  }
  return (
    <span className="font-mono text-primary/70" data-testid="message-math-fallback">
      {expr}
    </span>
  );
}

function MathSlot({ expr, display }) {
  return (
    <Suspense fallback={<MathFallback expr={expr} display={display} />}>
      <LazyMessageMath expr={expr} display={display} />
    </Suspense>
  );
}

/** @type {import("react-markdown").Components} */
const markdownComponents = {
  h1: ({ children }) => <h1 className="md-heading md-h1">{children}</h1>,
  h2: ({ children }) => <h2 className="md-heading md-h2">{children}</h2>,
  h3: ({ children }) => <h3 className="md-heading md-h3">{children}</h3>,
  h4: ({ children }) => <h4 className="md-heading md-h4">{children}</h4>,
  h5: ({ children }) => <h5 className="md-heading md-h5">{children}</h5>,
  h6: ({ children }) => <h6 className="md-heading md-h6">{children}</h6>,
  em: ({ children }) => <em className={ROLEPLAY_ACTION_CLASS}>{children}</em>,
  strong: ({ children }) => <strong className="font-semibold text-primary/90">{children}</strong>,
  a: ({ href, children }) => {
    const safe = sanitizeHref(href);
    if (!safe) return <span>{children}</span>;
    return (
      <a href={safe} target="_blank" rel="noopener noreferrer" className="md-link">
        {children}
      </a>
    );
  },
  // Remote markdown images are not fetched. Attachments already cover photos
  // the companion or the reader actually sent.
  img: ({ alt }) => (
    <span
      className="italic text-primary/50"
      title="Images in chat load only from attachments, not from message links"
    >
      {alt ? `[image: ${alt}]` : "[image]"}
    </span>
  ),
  blockquote: ({ children }) => <blockquote className="md-blockquote">{children}</blockquote>,
  table: ({ children }) => (
    <div className="md-table-wrap">
      <table className="md-table">{children}</table>
    </div>
  ),
  hr: () => <hr className="md-hr" />,
  // Code blocks render their own <pre>, so drop the wrapper remark emits.
  pre: ({ children }) => children,
  code: ({ className, children }) => {
    const lang = /language-([A-Za-z0-9_+-]+)/.exec(classList(className).join(" "))?.[1];
    const text = nodeText(children);
    const isBlock = Boolean(lang) || text.includes("\n");
    if (isBlock) {
      return <MessageCodeBlock language={lang || "text"} code={text.replace(/\n$/, "")} />;
    }
    return <code className="md-inline-code">{children}</code>;
  },
  span: (props) => {
    if (hasClass(props.className, "md-math-inline")) {
      return <MathSlot expr={mathExprFromProps(props)} display={false} />;
    }
    return <span className={classList(props.className).join(" ") || undefined}>{props.children}</span>;
  },
  div: (props) => {
    if (hasClass(props.className, "md-math-display")) {
      return <MathSlot expr={mathExprFromProps(props)} display />;
    }
    return <div className={classList(props.className).join(" ") || undefined}>{props.children}</div>;
  },
  input: (props) => {
    if (props.type !== "checkbox") return null;
    return (
      <input
        type="checkbox"
        checked={Boolean(props.checked)}
        disabled
        readOnly
        tabIndex={-1}
        aria-label={props.checked ? "Completed task" : "Incomplete task"}
        className="md-task mr-1 align-middle accent-cyan-400"
      />
    );
  },
};

/**
 * @param {string} url
 */
function urlTransform(url) {
  return sanitizeHref(url) || "";
}

/**
 * GitHub-flavored markdown for a chat bubble, including roleplay *actions*,
 * tables, task lists, code fences and math. Unclosed fences and $$ mid-stream
 * are closed before parse so the bubble does not jump into raw-marker mode.
 *
 * @param {{ content?: string }} props
 */
function MessageMarkdown({ content }) {
  const prepared = useMemo(() => prepareStreamingMarkdown(content || ""), [content]);
  return (
    <div className="message-md" data-testid="message-markdown">
      <ReactMarkdown
        remarkPlugins={REMARK_PLUGINS}
        remarkRehypeOptions={REHYPE_OPTIONS}
        urlTransform={urlTransform}
        components={markdownComponents}
      >
        {prepared}
      </ReactMarkdown>
    </div>
  );
}

export default memo(MessageMarkdown);
