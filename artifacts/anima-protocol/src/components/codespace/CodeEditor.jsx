import { useRef, useCallback } from "react";
import { highlight } from "./highlight";
import { languageForPath } from "@/lib/codespace/projectModel";

// A lightweight code editor: a transparent <textarea> layered exactly over a
// syntax-highlighted <pre>. The textarea handles input/selection; the pre shows
// the colors. Scroll positions are kept in sync. No external editor dependency.
export default function CodeEditor({ path, value, onChange, readOnly = false }) {
  const taRef = useRef(null);
  const preRef = useRef(null);
  const language = languageForPath(path || "");

  const syncScroll = useCallback(() => {
    if (preRef.current && taRef.current) {
      preRef.current.scrollTop = taRef.current.scrollTop;
      preRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const ta = e.target;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = value.slice(0, start) + "  " + value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  };

  const highlighted = highlight(value || "", language) + "\n";

  return (
    <div className="relative flex-1 min-h-0 overflow-hidden bg-[#06060d]">
      <style>{`
        .cs-editor .tok-kw { color: #c084fc; }
        .cs-editor .tok-str { color: #4ade80; }
        .cs-editor .tok-com { color: #475569; font-style: italic; }
        .cs-editor .tok-num { color: #fbbf24; }
        .cs-editor .tok-prop { color: #22d3ee; }
      `}</style>
      <pre
        ref={preRef}
        aria-hidden="true"
        className="cs-editor absolute inset-0 m-0 overflow-auto whitespace-pre p-3 font-mono text-xs leading-[1.5] text-primary/90 pointer-events-none"
        dangerouslySetInnerHTML={{ __html: highlighted }}
      />
      <textarea
        ref={taRef}
        value={value || ""}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onKeyDown={handleKeyDown}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        className="cs-editor absolute inset-0 m-0 resize-none overflow-auto whitespace-pre bg-transparent p-3 font-mono text-xs leading-[1.5] text-transparent caret-cyan-300 outline-none"
        style={{ WebkitTextFillColor: "transparent" }}
      />
    </div>
  );
}
