import { useState } from "react";
import { FileCode2, FilePlus2, Trash2, FolderClock, RotateCcw, ChevronRight, ChevronDown } from "lucide-react";
import { workspaceFiles, sessionFiles } from "@/lib/codespace/projectModel";

// VS Code–style file explorer. Lists workspace files plus a ".sessions" folder
// (saved build snapshots) that can be restored to continue a previous session.
export default function FileExplorer({
  files,
  activePath,
  onSelect,
  onCreate,
  onDelete,
  onRestoreSession,
  onSaveSession,
}) {
  const [sessionsOpen, setSessionsOpen] = useState(true);
  const ws = workspaceFiles(files);
  const sessions = sessionFiles(files);

  const handleCreate = () => {
    const name = window.prompt("New file name (e.g. app.js, page.html, main.py)");
    if (name && name.trim()) onCreate(name.trim());
  };

  return (
    <div className="flex flex-col h-full bg-[#090912] border-r border-primary/15">
      <div className="flex items-center justify-between px-3 py-2 border-b border-primary/10">
        <span className="font-mono text-[10px] tracking-[0.25em] uppercase text-primary/60">
          // Explorer
        </span>
        <button
          onClick={handleCreate}
          title="New file"
          className="text-primary/40 hover:text-primary transition-colors"
        >
          <FilePlus2 className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto py-1">
        {ws.length === 0 && (
          <p className="px-3 py-2 font-mono text-[10px] text-primary/30">No files yet.</p>
        )}
        {ws.map((f) => (
          <div
            key={f.path}
            className={`group flex items-center gap-1.5 px-3 py-1 cursor-pointer transition-colors ${
              f.path === activePath
                ? "bg-primary/10 text-primary"
                : "text-primary/55 hover:bg-primary/5 hover:text-primary/80"
            }`}
            onClick={() => onSelect(f.path)}
          >
            <FileCode2 className="w-3 h-3 flex-shrink-0 opacity-70" />
            <span className="font-mono text-[11px] truncate flex-1">{f.path}</span>
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(f.path); }}
              className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-red-400 transition-all"
              title="Delete file"
            >
              <Trash2 className="w-3 h-3" />
            </button>
          </div>
        ))}

        {/* Sessions folder */}
        <div className="mt-2 border-t border-primary/10 pt-1">
          <div
            className="flex items-center gap-1.5 px-2 py-1 cursor-pointer text-primary/50 hover:text-primary/80"
            onClick={() => setSessionsOpen((v) => !v)}
          >
            {sessionsOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
            <FolderClock className="w-3 h-3" />
            <span className="font-mono text-[10px] tracking-[0.15em] uppercase flex-1">.sessions</span>
            <button
              onClick={(e) => { e.stopPropagation(); onSaveSession(); }}
              className="text-primary/40 hover:text-primary text-[9px] font-mono tracking-widest uppercase"
              title="Save current session here"
            >
              + save
            </button>
          </div>
          {sessionsOpen && (
            <div className="pl-3">
              {sessions.length === 0 && (
                <p className="px-3 py-1 font-mono text-[9px] text-primary/25">
                  Saved sessions appear here — reload one to continue.
                </p>
              )}
              {sessions.map((f) => (
                <div
                  key={f.path}
                  className="group flex items-center gap-1.5 px-3 py-1 text-primary/45 hover:bg-primary/5"
                >
                  <FileCode2 className="w-3 h-3 flex-shrink-0 opacity-60" />
                  <span className="font-mono text-[10px] truncate flex-1">
                    {f.path.replace(".sessions/", "")}
                  </span>
                  <button
                    onClick={() => onRestoreSession(f.path)}
                    className="opacity-0 group-hover:opacity-100 text-primary/40 hover:text-cyan-300 transition-all"
                    title="Reload this session"
                  >
                    <RotateCcw className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onDelete(f.path)}
                    className="opacity-0 group-hover:opacity-100 text-primary/30 hover:text-red-400 transition-all"
                    title="Delete session"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
