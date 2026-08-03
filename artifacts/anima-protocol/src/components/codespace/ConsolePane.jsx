import { Terminal, Trash2 } from "lucide-react";
import { useEffect, useRef } from "react";

const LEVEL_COLORS = {
  log: "text-primary/75",
  info: "text-cyan-300/80",
  warn: "text-amber-400/90",
  error: "text-red-400/90",
};

// Output/console pane. Shows stdout/stderr/errors captured from the sandbox
// (worker logs, Python output, and web preview console messages).
export default function ConsolePane({ logs, onClear }) {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [logs]);

  return (
    <div className="flex flex-col h-full bg-[#06060d]">
      <div className="flex items-center justify-between px-3 py-1.5 bg-[#090912] border-b border-primary/15">
        <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-[0.2em] uppercase text-primary/60">
          <Terminal className="w-3 h-3" /> Console
        </span>
        <button
          onClick={onClear}
          className="text-primary/40 hover:text-primary transition-colors"
          title="Clear console"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2 font-mono text-[11px] leading-relaxed">
        {logs.length === 0 && (
          <p className="text-primary/25">// console output appears here</p>
        )}
        {logs.map((l, i) => (
          <div key={i} className={`whitespace-pre-wrap break-words ${LEVEL_COLORS[l.level] || LEVEL_COLORS.log}`}>
            <span className="text-primary/25 select-none">{l.level === "error" ? "✖ " : l.level === "warn" ? "▲ " : "› "}</span>
            {l.text}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  );
}
