import { useState, useRef, useEffect } from "react";
import { Send, Square, Cpu, FileCode2, Play, ScanLine, Bot, Wrench, Terminal, ShieldAlert } from "lucide-react";

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

// The companion / Jules AI Engineer build console: a goal input plus an in-character transcript of
// narration and the tool steps it takes (files changing, scans, runs), so the
// agentic loop is visible in the workspace.
export default function AgentPanel({ companion, log, running, onSend, onStop, onDebugAndTroubleshoot }) {
  const [input, setInput] = useState("");
  const endRef = useRef(null);

  const isJules = companion?.id === "jules-ai-engineer";

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [log, running]);

  const submit = () => {
    const v = input.trim();
    if (!v || running) return;
    onSend(v);
    setInput("");
  };

  const handleTroubleshootClick = () => {
    if (running) return;
    if (onDebugAndTroubleshoot) {
      onDebugAndTroubleshoot();
    } else {
      onSend("Run a complete diagnostic, debug any errors in the project, and fix code issues directly.");
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#090912] border-l border-primary/15">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 bg-[#0c0c16]">
        <Bot className={`w-3.5 h-3.5 ${isJules ? "text-cyan-400" : "text-primary/60"}`} />
        <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/80 flex-1 truncate">
          {companion?.name || "NetNavi"} · {isJules ? "Jules API Agent" : "Build Agent"}
        </span>
        {running && (
          <span className="flex items-center gap-1 font-mono text-[8px] tracking-widest uppercase text-cyan-300">
            <Cpu className="w-3 h-3 animate-pulse" /> working
          </span>
        )}
      </div>

      <div className="px-3 py-1.5 border-b border-primary/10 bg-black/40 flex items-center justify-between">
        <span className="font-mono text-[9px] text-primary/50 uppercase tracking-wider">
          {isJules ? "Jules AI Engineer API" : "Companion Agent"}
        </span>
        <button
          onClick={handleTroubleshootClick}
          disabled={running}
          className="flex items-center gap-1 px-2 py-0.5 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-30 font-mono text-[9px] uppercase tracking-wider transition-colors"
          title="Directly debug & troubleshoot issues in your codespace"
        >
          <Wrench className="w-2.5 h-2.5" /> Debug & Troubleshoot
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {log.length === 0 && (
          <div className="font-mono text-[10px] text-primary/40 leading-relaxed space-y-2">
            <p>
              {isJules
                ? "Jules API is active. Ask Jules to code features, debug runtime errors, scan for security issues, or troubleshoot your project directly."
                : `Give ${companion?.name || "your companion"} a build goal — e.g. “build a neon snake game” or “write a python script that prints the first 20 primes.”`}
            </p>
            <div className="pt-2 border-t border-primary/10 flex flex-col gap-1">
              <span className="text-[9px] uppercase text-cyan-400 font-semibold tracking-wider">Quick Commands:</span>
              <button
                onClick={() => handleTroubleshootClick()}
                className="text-left text-[10px] text-primary/70 hover:text-cyan-300 transition-colors flex items-center gap-1"
              >
                <ShieldAlert className="w-3 h-3 text-cyan-400" /> Troubleshoot project & fix errors
              </button>
              <button
                onClick={() => onSend("Scan code files for vulnerabilities, syntax errors, and performance bottlenecks.")}
                className="text-left text-[10px] text-primary/70 hover:text-cyan-300 transition-colors flex items-center gap-1"
              >
                <Terminal className="w-3 h-3 text-cyan-400" /> Scan project & audit security
              </button>
            </div>
          </div>
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
                  : isJules
                  ? "bg-cyan-950/20 border border-cyan-500/30 text-cyan-100"
                  : "bg-black/50 border border-primary/15 text-primary/80"
              }`}
            >
              {!isUser && (
                <span className={`block text-[8px] tracking-[0.2em] uppercase mb-1 ${isJules ? "text-cyan-400" : "text-primary/40"}`}>
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
            placeholder={isJules ? "Code, debug, or troubleshoot with Jules..." : "Describe what to build..."}
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
