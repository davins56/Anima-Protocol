import { useState, useRef, useEffect } from "react";
import { Send, Square, Cpu, FileCode2, Play, ScanLine, Bot } from "lucide-react";

const TOOL_ICON = {
  write_file: FileCode2,
  read_file: FileCode2,
  delete_file: FileCode2,
  list_files: FileCode2,
  run_code: Play,
  scan_code: ScanLine,
};

const TOOL_VERB = {
  write_file: "wrote",
  read_file: "read",
  delete_file: "deleted",
  list_files: "listed files",
  run_code: "ran",
  scan_code: "scanned",
};

// The companion's build console: a goal input plus an in-character transcript of
// narration and the tool steps it takes (files changing, scans, runs), so the
// agentic loop is visible in the workspace.
export default function AgentPanel({ companion, log, running, onSend, onStop }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log, running]);

  const submit = () => {
    const v = input.trim();
    if (!v || running) return;
    onSend(v);
    setInput("");
  };

  return (
    <div className="flex flex-col h-full bg-[#090912] border-l border-primary/15">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10">
        <Bot className="w-3.5 h-3.5 text-primary/60" />
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/60 flex-1 truncate">
          {companion?.name || "NetNavi"} · Build Agent
        </span>
        {running && (
          <span className="flex items-center gap-1 font-mono text-[8px] tracking-widest uppercase text-cyan-300">
            <Cpu className="w-3 h-3 animate-pulse" /> working
          </span>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {log.length === 0 && (
          <p className="font-mono text-[10px] text-primary/30 leading-relaxed">
            Give {companion?.name || "your companion"} a build goal — e.g.
            “build a neon snake game” or “write a python script that prints the
            first 20 primes.” It will create files, scan for viruses, run the
            code, and fix errors until it works.
          </p>
        )}
        {log.map((entry, i) => {
          if (entry.type === "tool") {
            const Icon = TOOL_ICON[entry.name] || Cpu;
            const verb = TOOL_VERB[entry.name] || entry.name;
            return (
              <div key={i} className="flex items-center gap-2 font-mono text-[10px] text-primary/40 pl-1">
                <Icon className="w-3 h-3 flex-shrink-0" />
                <span className="truncate">
                  {verb}
                  {entry.detail ? ` ${entry.detail}` : ""}
                </span>
              </div>
            );
          }
          const isUser = entry.role === "user";
          return (
            <div
              key={i}
              className={`max-w-[92%] px-3 py-2 font-mono text-[11px] leading-relaxed hud-corner ${
                isUser
                  ? "ml-auto bg-primary/10 border border-primary/30 text-primary/90"
                  : "bg-black/50 border border-primary/15 text-primary/80"
              }`}
            >
              {!isUser && (
                <span className="block text-[8px] tracking-[0.2em] uppercase text-primary/40 mb-1">
                  [{companion?.name || "NetNavi"}]
                </span>
              )}
              {entry.content}
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-primary/10 p-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Describe what to build..."
            rows={2}
            className="flex-1 resize-none bg-black/50 border border-primary/20 text-primary/90 font-mono text-[11px] p-2 focus:outline-none focus:border-primary/50"
          />
          {running ? (
            <button
              onClick={onStop}
              className="flex items-center justify-center w-9 h-9 border border-red-400/40 text-red-400 hover:bg-red-500/10 transition-all"
              title="Stop"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="flex items-center justify-center w-9 h-9 border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-30 transition-all"
              title="Send"
            >
              <Send className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
