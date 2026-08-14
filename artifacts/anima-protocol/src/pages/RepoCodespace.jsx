import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play, Save, PanelLeft, Bot, FileCode2, Loader2, Cpu, Terminal as TerminalIcon, Globe, Wrench, Trash2, Folder, Plus, Check, ChevronRight, ChevronDown, RotateCcw
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

// API Helpers
async function repoFetch(path, options = {}) {
  const headers = await authHeaders(options.headers);
  const url = apiUrl(`/repo-codespace${path}`);
  const res = await fetch(url, {
    ...options,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try {
      const json = JSON.parse(text);
      msg = json.error || msg;
    } catch {
      // use raw text
    }
    throw new Error(msg || `HTTP ${res.status}`);
  }
  return res.json();
}

// Convert flat file list to directory tree
function buildFileTree(files) {
  const root = { name: "Root", isDirectory: true, children: {}, path: "" };
  files.forEach((file) => {
    const parts = file.path.split("/");
    let current = root;
    parts.forEach((part, index) => {
      const isLast = index === parts.length - 1;
      const subPath = parts.slice(0, index + 1).join("/");

      if (isLast && !file.isDirectory) {
        current.children[part] = {
          name: part,
          path: subPath,
          isDirectory: false,
        };
      } else {
        if (!current.children[part]) {
          current.children[part] = {
            name: part,
            path: subPath,
            isDirectory: true,
            children: {},
          };
        }
        current = current.children[part];
      }
    });
  });
  return root;
}

export default function RepoCodespace() {
  const [files, setFiles] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [fileContent, setFileContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [terminalLogs, setTerminalLogs] = useState([]);
  const [cmdInput, setCmdInput] = useState("");
  const [characters, setCharacters] = useState([]);
  const [companionId, setCompanionId] = useState(null);
  const [agentLog, setAgentLog] = useState([]);
  const [agentOpen, setAgentOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [collapsedDirs, setCollapsedDirs] = useState({});
  const [newFileName, setNewFileName] = useState("");
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentGoal, setAgentGoal] = useState("");

  const endRef = useRef(null);
  const termEndRef = useRef(null);
  const stopAgentRef = useRef(false);

  const companion = characters.find((c) => c.id === companionId) || null;

  // Load characters and repo files
  const loadWorkspace = useCallback(async () => {
    try {
      const data = await repoFetch("/files");
      setFiles(data.files || []);
    } catch (e) {
      console.error("Failed to load repo files", e);
      pushTermLog(`[SYSTEM ERROR] Failed to load workspace files: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCharacters = useCallback(() => {
    base44.entities.Character.list("-updated_date", 100)
      .then((cs) => setCharacters(cs || []))
      .catch(() => setCharacters([]));
  }, []);

  useEffect(() => {
    loadWorkspace();
    whenBootstrapReady().then(() => loadCharacters());
  }, [loadWorkspace, loadCharacters]);

  useStoreSync(loadCharacters);

  // Default the companion
  useEffect(() => {
    if (!companionId && characters.length) {
      setCompanionId(characters[0].id);
    }
  }, [characters, companionId]);

  // Load file content when active path changes
  useEffect(() => {
    if (!activePath) return;
    let cancelled = false;
    repoFetch("/read-file", {
      method: "POST",
      body: JSON.stringify({ path: activePath }),
    })
      .then((data) => {
        if (!cancelled) {
          setFileContent(data.content);
          setOriginalContent(data.content);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          pushTermLog(`[SYSTEM ERROR] Failed to read ${activePath}: ${e.message}`, "error");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [activePath]);

  // Scroll logging panels
  useEffect(() => {
    termEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [terminalLogs]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [agentLog, agentRunning]);

  const pushTermLog = (text, level = "info") => {
    setTerminalLogs((prev) => [...prev, { text, level }].slice(-500));
  };

  const handleRunCommand = async (commandToRun) => {
    const cmd = (commandToRun || cmdInput).trim();
    if (!cmd) return;
    setTerminalBusy(true);
    setCmdInput("");
    pushTermLog(`$ ${cmd}`, "cmd");
    try {
      const data = await repoFetch("/terminal", {
        method: "POST",
        body: JSON.stringify({ command: cmd }),
      });
      if (data.stdout) pushTermLog(data.stdout, "stdout");
      if (data.stderr) pushTermLog(data.stderr, "stderr");
      pushTermLog(`Command exited with status code: ${data.code}`, data.code === 0 ? "success" : "error");
      loadWorkspace(); // Refresh files list in case files were generated/deleted
    } catch (e) {
      pushTermLog(`Execution failed: ${e.message}`, "error");
    } finally {
      setTerminalBusy(false);
    }
  };

  const handleSaveFile = async () => {
    if (!activePath) return;
    setBusy(true);
    try {
      await repoFetch("/write-file", {
        method: "POST",
        body: JSON.stringify({ path: activePath, content: fileContent }),
      });
      setOriginalContent(fileContent);
      pushTermLog(`Successfully saved changes to ${activePath}`, "success");
    } catch (e) {
      pushTermLog(`Failed to save ${activePath}: ${e.message}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFile = async () => {
    if (!newFileName.trim()) return;
    try {
      await repoFetch("/write-file", {
        method: "POST",
        body: JSON.stringify({ path: newFileName.trim(), content: "" }),
      });
      pushTermLog(`Created file ${newFileName}`, "success");
      setActivePath(newFileName.trim());
      setNewFileName("");
      setShowCreateInput(false);
      loadWorkspace();
    } catch (e) {
      pushTermLog(`Failed to create file: ${e.message}`, "error");
    }
  };

  const handleDeleteFile = async (pathToDelete) => {
    if (!window.confirm(`Are you sure you want to delete ${pathToDelete}?`)) return;
    try {
      await repoFetch("/delete-file", {
        method: "POST",
        body: JSON.stringify({ path: pathToDelete }),
      });
      pushTermLog(`Deleted file ${pathToDelete}`, "success");
      if (activePath === pathToDelete) {
        setActivePath("");
        setFileContent("");
      }
      loadWorkspace();
    } catch (e) {
      pushTermLog(`Failed to delete file: ${e.message}`, "error");
    }
  };

  const toggleDir = (dirPath) => {
    setCollapsedDirs((prev) => ({ ...prev, [dirPath]: !prev[dirPath] }));
  };

  // Tandem AI agent loop running on server-side repo codespace endpoints
  const runAgentGoal = async (goal) => {
    if (!goal.trim() || agentRunning) return;
    stopAgentRef.current = false;
    setAgentRunning(true);
    setAgentLog((prev) => [...prev, { role: "user", content: goal }]);
    setAgentGoal("");

    const messages = [{ role: "user", content: goal.trim() }];
    const MAX_STEPS = 12;

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopAgentRef.current) {
          setAgentLog((prev) => [...prev, { role: "assistant", content: "[Agent paused by steward]" }]);
          break;
        }

        const res = await repoFetch("/agent-step", {
          method: "POST",
          body: JSON.stringify({
            messages,
            character: companion
              ? {
                  name: companion.name,
                  personality: companion.personality,
                  speaking_style: companion.speaking_style,
                }
              : null,
            files: files.map((f) => f.path),
          }),
        });

        const assistant = res?.result?.message;
        if (!assistant) {
          setAgentLog((prev) => [...prev, { role: "assistant", content: "⚠ The companion connection dropped. Let's try again." }]);
          break;
        }

        // Add assistant message to local trace
        messages.push({
          role: "assistant",
          content: assistant.content || "",
          ...(assistant.tool_calls ? { tool_calls: assistant.tool_calls } : {}),
        });

        if (assistant.content) {
          setAgentLog((prev) => [...prev, { role: "assistant", content: assistant.content }]);
        }

        const calls = assistant.tool_calls || [];
        if (!calls.length) {
          // done
          break;
        }

        for (const tc of calls) {
          if (stopAgentRef.current) break;
          const name = tc.function?.name;
          let args = {};
          try {
            args = JSON.parse(tc.function?.arguments || "{}");
          } catch {
            args = {};
          }

          setAgentLog((prev) => [...prev, { type: "tool-start", name, detail: args.path || args.command || "" }]);

          let out = {};
          try {
            if (name === "list_repo_files") {
              const data = await repoFetch("/files");
              out = { files: data.files?.map((f) => f.path) };
            } else if (name === "read_repo_file") {
              const data = await repoFetch("/read-file", {
                method: "POST",
                body: JSON.stringify({ path: args.path }),
              });
              out = { path: args.path, content: data.content };
              // Sync loaded file in UI if it matches current active path
              if (args.path === activePath) {
                setFileContent(data.content);
                setOriginalContent(data.content);
              }
            } else if (name === "write_repo_file") {
              await repoFetch("/write-file", {
                method: "POST",
                body: JSON.stringify({ path: args.path, content: args.content }),
              });
              out = { success: true, path: args.path };
              // Sync UI if matches active path
              if (args.path === activePath) {
                setFileContent(args.content);
                setOriginalContent(args.content);
              }
            } else if (name === "delete_repo_file") {
              await repoFetch("/delete-file", {
                method: "POST",
                body: JSON.stringify({ path: args.path }),
              });
              out = { success: true, path: args.path };
              if (args.path === activePath) {
                setActivePath("");
                setFileContent("");
              }
            } else if (name === "run_terminal_command") {
              const data = await repoFetch("/terminal", {
                method: "POST",
                body: JSON.stringify({ command: args.command }),
              });
              out = { stdout: data.stdout, stderr: data.stderr, code: data.code };
              pushTermLog(`[AGENT RUN] $ ${args.command}`, "cmd");
              if (data.stdout) pushTermLog(data.stdout, "stdout");
              if (data.stderr) pushTermLog(data.stderr, "stderr");
            }
          } catch (err) {
            out = { error: err.message };
          }

          setAgentLog((prev) => [...prev, { type: "tool-done", name, success: !out.error }]);

          messages.push({
            role: "tool",
            tool_call_id: tc.id,
            content: JSON.stringify(out).slice(0, 8000),
          });
        }
        // Refresh workspace list after agent actions
        loadWorkspace();
      }
    } catch (e) {
      console.error(e);
      setAgentLog((prev) => [...prev, { role: "assistant", content: `⚠ Error in build flow: ${e.message}` }]);
    } finally {
      setAgentRunning(false);
    }
  };

  const renderTreeNodes = (node) => {
    const sortedKeys = Object.keys(node.children).sort((a, b) => {
      const aNode = node.children[a];
      const bNode = node.children[b];
      if (aNode.isDirectory && !bNode.isDirectory) return -1;
      if (!aNode.isDirectory && bNode.isDirectory) return 1;
      return a.localeCompare(b);
    });

    return sortedKeys.map((key) => {
      const child = node.children[key];
      const isCollapsed = collapsedDirs[child.path];
      if (child.isDirectory) {
        return (
          <div key={child.path} className="pl-2 font-mono text-[11px]">
            <button
              onClick={() => toggleDir(child.path)}
              className="flex items-center gap-1 py-1 w-full text-left text-primary/70 hover:text-primary transition-colors"
            >
              {isCollapsed ? <ChevronRight className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              <Folder className="w-3.5 h-3.5 text-cyan-400/60" />
              <span className="truncate">{child.name}</span>
            </button>
            {!isCollapsed && <div className="border-l border-primary/10 pl-1">{renderTreeNodes(child)}</div>}
          </div>
        );
      }
      return (
        <div
          key={child.path}
          className={`group flex items-center justify-between pl-5 py-0.5 font-mono text-[11px] hover:bg-primary/5 transition-all ${
            activePath === child.path ? "bg-primary/10 text-primary border-r-2 border-primary" : "text-primary/50"
          }`}
        >
          <button
            onClick={() => setActivePath(child.path)}
            className="flex items-center gap-1 py-1 w-full text-left truncate"
          >
            <FileCode2 className="w-3.5 h-3.5 text-primary/40" />
            <span className="truncate">{child.name}</span>
          </button>
          <button
            onClick={() => handleDeleteFile(child.path)}
            className="opacity-0 group-hover:opacity-100 p-1 text-red-400 hover:text-red-300 transition-all mr-1"
            title="Delete File"
          >
            <Trash2 className="w-3 h-3" />
          </button>
        </div>
      );
    });
  };

  const fileTreeRoot = buildFileTree(files);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 grid place-items-center bg-[#06060d]">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary animate-spin mx-auto mb-2" />
          <p className="font-mono text-xs text-primary/40 uppercase tracking-widest">Compiling Repository...</p>
        </div>
      </div>
    );
  }

  const isDirty = fileContent !== originalContent;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#06060d] text-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/15 bg-[#090912]">
        <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-primary/80 hidden sm:inline">
          // REPO WORKSPACE
        </span>

        <select
          value={companionId || ""}
          onChange={(e) => setCompanionId(e.target.value)}
          className="bg-black/50 border border-primary/20 text-primary/80 font-mono text-[10px] px-2 py-1 focus:outline-none focus:border-primary/50 max-w-[140px]"
          title="Companion Agent"
        >
          {characters.length === 0 && <option value="">No companions</option>}
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* Quick terminal actions */}
        <div className="hidden lg:flex items-center gap-1 ml-4 border-l border-primary/15 pl-4">
          <button
            onClick={() => handleRunCommand("pnpm run typecheck")}
            className="px-2 py-1 border border-primary/10 text-[9px] font-mono hover:bg-primary/5 rounded uppercase"
          >
            Typecheck
          </button>
          <button
            onClick={() => handleRunCommand("git status")}
            className="px-2 py-1 border border-primary/10 text-[9px] font-mono hover:bg-primary/5 rounded uppercase"
          >
            Git Status
          </button>
          <button
            onClick={() => handleRunCommand("git diff")}
            className="px-2 py-1 border border-primary/10 text-[9px] font-mono hover:bg-primary/5 rounded uppercase"
          >
            Git Diff
          </button>
        </div>

        <button
          onClick={() => setAgentOpen((v) => !v)}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 border font-mono text-[10px] tracking-[0.15em] uppercase ml-auto transition-all ${
            agentOpen || agentRunning
              ? "border-primary text-primary bg-primary/10"
              : "border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40"
          }`}
        >
          <Bot className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Anima Agent</span>
        </button>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Real File Explorer Panel */}
        <div className="w-56 border-r border-primary/15 bg-[#080810] flex flex-col flex-shrink-0">
          <div className="p-2 border-b border-primary/10 flex items-center justify-between">
            <span className="font-mono text-[10px] tracking-wider text-primary/50 uppercase">Repository Files</span>
            <button
              onClick={() => setShowCreateInput(!showCreateInput)}
              className="text-primary/50 hover:text-primary transition-all p-1"
              title="Create New File"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </div>

          {showCreateInput && (
            <div className="p-2 border-b border-primary/10 bg-black/30">
              <input
                type="text"
                placeholder="e.g. src/utils/math.ts"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFile()}
                className="w-full bg-black/60 border border-primary/20 text-primary font-mono text-[10px] p-1.5 focus:outline-none focus:border-primary/50"
              />
              <div className="flex justify-end gap-1 mt-1.5">
                <button
                  onClick={() => setShowCreateInput(false)}
                  className="text-[9px] font-mono px-1.5 py-0.5 text-primary/40 hover:text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCreateFile}
                  className="text-[9px] font-mono px-1.5 py-0.5 border border-primary/40 text-primary hover:bg-primary/5"
                >
                  Create
                </button>
              </div>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-2">
            {renderTreeNodes(fileTreeRoot)}
          </div>
        </div>

        {/* Workspace Code space and Terminal Column */}
        <div className="flex-1 flex flex-col min-h-0">
          {/* Editor Header */}
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#090912] border-b border-primary/10">
            <div className="flex items-center gap-2">
              <FileCode2 className="w-3.5 h-3.5 text-primary/50" />
              <span className="font-mono text-[11px] text-primary/70 select-all">{activePath || "No file opened"}</span>
              {isDirty && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" title="Unsaved changes" />
              )}
            </div>
            {activePath && (
              <button
                onClick={handleSaveFile}
                disabled={busy || !isDirty}
                className="flex items-center gap-1.5 px-2.5 py-1 text-xs border border-primary/40 text-primary disabled:opacity-30 hover:bg-primary/5 rounded font-mono uppercase tracking-wider transition-all"
              >
                <Save className="w-3 h-3" /> Save File
              </button>
            )}
          </div>

          {/* Real Code Space */}
          <div className="flex-1 min-h-0 relative">
            {activePath ? (
              <textarea
                value={fileContent}
                onChange={(e) => setFileContent(e.target.value)}
                className="w-full h-full p-4 bg-black/80 font-mono text-[12px] leading-relaxed text-cyan-100 resize-none focus:outline-none focus:bg-black/90 transition-all border-b border-primary/10 select-text"
                spellCheck={false}
              />
            ) : (
              <div className="w-full h-full grid place-items-center bg-black/40">
                <div className="text-center">
                  <FileCode2 className="w-8 h-8 text-primary/20 mx-auto mb-2" />
                  <p className="font-mono text-[11px] text-primary/30 uppercase tracking-widest">
                    Select a repository file from explorer to edit source code
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Web Terminal Console */}
          <div className="h-48 border-t border-primary/15 bg-black flex flex-col min-h-0">
            <div className="flex items-center justify-between px-3 py-1.5 bg-[#090912] border-b border-primary/10 flex-shrink-0">
              <div className="flex items-center gap-2 font-mono text-[10px] tracking-wider text-primary/60 uppercase">
                <TerminalIcon className="w-3.5 h-3.5" /> Workspace Terminal
              </div>
              <button
                onClick={() => setTerminalLogs([])}
                className="text-primary/40 hover:text-primary p-1 rounded"
                title="Clear terminal logs"
              >
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>

            {/* Terminal Screen output logs */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-[11px] space-y-1 scrollbar-thin select-text">
              {terminalLogs.length === 0 && (
                <div className="text-primary/20 italic">
                  Terminal ready. Run tasks or compile files in tandem with your companion...
                </div>
              )}
              {terminalLogs.map((log, i) => {
                let color = "text-primary/60";
                if (log.level === "cmd") color = "text-cyan-300 font-semibold";
                if (log.level === "stdout") color = "text-primary/80";
                if (log.level === "stderr" || log.level === "error") color = "text-red-400";
                if (log.level === "success") color = "text-emerald-400";
                return (
                  <div key={i} className={`whitespace-pre-wrap leading-relaxed ${color}`}>
                    {log.text}
                  </div>
                );
              })}
              {terminalBusy && (
                <div className="flex items-center gap-1.5 text-cyan-400 animate-pulse">
                  <Cpu className="w-3 h-3 animate-spin" /> executing command...
                </div>
              )}
              <div ref={termEndRef} />
            </div>

            {/* Terminal Prompt input */}
            <div className="flex items-center gap-2 border-t border-primary/10 bg-black/95 p-2 flex-shrink-0">
              <span className="font-mono text-cyan-400 font-bold text-xs pl-1 select-none">$</span>
              <input
                type="text"
                placeholder="Type terminal command (e.g. pnpm run test, git status, git diff)..."
                value={cmdInput}
                onChange={(e) => setCmdInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleRunCommand()}
                disabled={terminalBusy}
                className="flex-1 bg-transparent text-primary font-mono text-xs focus:outline-none"
              />
              <button
                onClick={() => handleRunCommand()}
                disabled={terminalBusy || !cmdInput.trim()}
                className="px-3 py-1 bg-cyan-500/10 border border-cyan-400/30 text-cyan-300 hover:bg-cyan-500/20 disabled:opacity-30 rounded font-mono text-[10px] tracking-wider uppercase transition-all"
              >
                Execute
              </button>
            </div>
          </div>
        </div>

        {/* Collaborative Anima Agent Drawer/Panel */}
        <AnimatePresence>
          {agentOpen && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 340, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="border-l border-primary/15 bg-[#090912] flex flex-col flex-shrink-0 min-h-0 overflow-hidden"
            >
              <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/10 flex-shrink-0">
                <Bot className="w-3.5 h-3.5 text-primary/60" />
                <span className="font-mono text-[10px] tracking-[0.2em] uppercase text-primary/60 flex-1 truncate">
                  {companion?.name || "NetNavi"} · Companion Agent
                </span>
                {agentRunning && (
                  <span className="flex items-center gap-1 font-mono text-[8px] tracking-widest uppercase text-cyan-300">
                    <Cpu className="w-3 h-3 animate-pulse" /> coding
                  </span>
                )}
              </div>

              {/* Chat Log trace */}
              <div className="flex-1 overflow-y-auto p-3 space-y-2 select-text">
                {agentLog.length === 0 && (
                  <p className="font-mono text-[10px] text-primary/40 leading-relaxed">
                    Collaborate with {companion?.name || "your companion"} to edit the real source code of this repository!
                    <br /><br />
                    Describe what to improve or enhance — e.g. "Add styling to Landing.tsx" or "Write a bash command to check lints."
                    Your companion can read, write, edit files and run terminal commands to verify everything compiles cleanly!
                  </p>
                )}
                {agentLog.map((entry, i) => {
                  if (entry.type === "tool-start") {
                    return (
                      <div key={i} className="flex items-center gap-2 font-mono text-[10px] text-primary/40 pl-1">
                        <Cpu className="w-3 h-3 animate-spin text-cyan-400" />
                        <span className="truncate">
                          Working: {entry.name} {entry.detail && `(${entry.detail})`}
                        </span>
                      </div>
                    );
                  }
                  if (entry.type === "tool-done") {
                    return (
                      <div key={i} className="flex items-center gap-2 font-mono text-[10px] text-emerald-400/60 pl-1">
                        <Check className="w-3 h-3" />
                        <span className="truncate">Completed: {entry.name}</span>
                      </div>
                    );
                  }
                  const isUser = entry.role === "user";
                  return (
                    <div
                      key={i}
                      className={`max-w-[92%] px-3 py-2 font-mono text-[11px] leading-relaxed border ${
                        isUser
                          ? "ml-auto bg-primary/10 border-primary/30 text-primary/90"
                          : "bg-black/50 border-primary/15 text-primary/80"
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

              {/* Chat Input */}
              <div className="border-t border-primary/10 p-2 flex-shrink-0">
                <div className="flex items-end gap-2">
                  <textarea
                    value={agentGoal}
                    onChange={(e) => setAgentGoal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        runAgentGoal(agentGoal);
                      }
                    }}
                    placeholder={`Instruct ${companion?.name || "your companion"}...`}
                    rows={2}
                    className="flex-1 resize-none bg-black/50 border border-primary/20 text-primary/90 font-mono text-[11px] p-2 focus:outline-none focus:border-primary/50"
                  />
                  {agentRunning ? (
                    <button
                      onClick={() => { stopAgentRef.current = true; }}
                      className="flex items-center justify-center w-9 h-9 border border-red-400/40 text-red-400 hover:bg-red-500/10 transition-all"
                      title="Stop Agent"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  ) : (
                    <button
                      onClick={() => runAgentGoal(agentGoal)}
                      disabled={!agentGoal.trim()}
                      className="flex items-center justify-center w-9 h-9 border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-30 transition-all"
                      title="Send Instructions"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
