// @ts-check
import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";

/**
 * Fenced code block with a language label, a labelled copy button, and a
 * focusable, scrollable region. Syntax colouring is lazy-loaded and only
 * applied once it matches the current source, so a streaming fence stays as
 * stable plain text until the highlighter catches up.
 *
 * @param {{ language?: string, code: string }} props
 */
export default function MessageCodeBlock({ language = "text", code }) {
  const label = (language || "text").trim() || "text";
  const [highlighted, setHighlighted] = useState(
    /** @type {{ code: string, language: string, nodes: import("react").ReactNode[] } | null} */ (null),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    import("./prismHighlighter.js")
      .then((mod) => {
        if (cancelled) return;
        const nodes = mod.highlightToElements(code, label);
        if (!cancelled && nodes) {
          setHighlighted({ code, language: label, nodes });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [code, label]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(id);
  }, [copied]);

  const showHighlight = highlighted && highlighted.code === code && highlighted.language === label;

  const onCopy = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(code);
      } else {
        const area = document.createElement("textarea");
        area.value = code;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.left = "-9999px";
        document.body.appendChild(area);
        area.select();
        document.execCommand("copy");
        document.body.removeChild(area);
      }
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="md-code-block my-1.5 border border-primary/25 bg-black/50" data-testid="message-code-block">
      <div className="flex items-center justify-between gap-2 border-b border-primary/20 px-2 py-1">
        <span className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary/50">
          {label}
        </span>
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? "Copied" : "Copy code"}
          className="inline-flex items-center justify-center gap-1 min-h-[32px] min-w-[32px] px-1.5 font-mono text-[9px] uppercase tracking-widest text-primary/60 hover:text-primary transition-colors"
        >
          {copied ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre
        tabIndex={0}
        role="region"
        aria-label={`${label} code`}
        className="md-code-pre m-0 max-w-full overflow-x-auto px-2.5 py-2 font-mono text-[11px] sm:text-xs leading-relaxed text-primary/85 outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
      >
        <code className={`language-${label} whitespace-pre`}>
          {showHighlight ? highlighted.nodes : code}
        </code>
      </pre>
    </div>
  );
}
