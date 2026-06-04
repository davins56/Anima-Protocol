import { useState, useEffect, useRef, useCallback } from "react";
import {
  Play, Save, PanelLeft, Bot, FileCode2, Loader2, Cpu, Terminal as TerminalIcon, Globe,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import FileExplorer from "@/components/codespace/FileExplorer";
import CodeEditor from "@/components/codespace/CodeEditor";
import PreviewPane from "@/components/codespace/PreviewPane";
import ConsolePane from "@/components/codespace/ConsolePane";
import VirusBattleModal from "@/components/codespace/VirusBattleModal";
import AgentPanel from "@/components/codespace/AgentPanel";
import { scanCode, severityRank } from "@/lib/codespace/codeScanner";
import { buildPreviewSrcdoc, isPreviewMessage, runScript } from "@/lib/codespace/sandbox";
import {
  newProject, makeSessionSnapshot, parseSessionSnapshot, languageForPath,
  isSessionPath, workspaceFiles,
} from "@/lib/codespace/projectModel";
import { useCodespaceAgent } from "@/lib/codespace/useCodespaceAgent";

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function modeForPath(path) {
  const lang = languageForPath(path || "");
  if (lang === "html") return "web";
  if (lang === "python") return "python";
  if (lang === "css") return "web";
  return "js";
}

// Merge several per-file scan results into one (used to scan a whole web project
// — its HTML plus every JS file — before a single preview run).
function mergeScans(scans, label) {
  const findings = scans.flatMap((s) => s.findings);
  const maxSeverity = findings.reduce(
    (max, f) => (severityRank(f.severity) > severityRank(max) ? f.severity : max),
    "none",
  );
  return {
    path: label,
    findings: findings.sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    maxSeverity,
    safe: severityRank(maxSeverity) < severityRank("high"),
  };
}

export default function Codespace() {
  const [files, setFiles] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [previewSrcdoc, setPreviewSrcdoc] = useState("");
  const [characters, setCharacters] = useState([]);
  const [companionId, setCompanionId] = useState(null);
  const [agentLog, setAgentLog] = useState([]);
  const [battle, setBattle] = useState(null);
  const [mobileView, setMobileView] = useState("code"); // code | preview | console
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const filesRef = useRef([]);
  const agentLogRef = useRef([]);
  const projectIdRef = useRef(null);
  const runBufferRef = useRef(null);
  const runSeqRef = useRef(0);
  const gateRef = useRef(null);
  const saveTimerRef = useRef(null);
  const dirtyRef = useRef(false);

  const companion = characters.find((c) => c.id === companionId) || null;

  // ---- persistence -------------------------------------------------------
  const persistNow = useCallback(async () => {
    if (!projectIdRef.current) return;
    try {
      await base44.entities.CodespaceProject.update(projectIdRef.current, {
        files: filesRef.current,
        active_path: activePath,
        agent_log: agentLogRef.current,
        companion_id: companionId,
      });
      dirtyRef.current = false;
    } catch (e) {
      // Non-fatal: keep working locally; will retry on next change.
      console.error("Codespace save failed", e);
    }
  }, [activePath, companionId]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => persistNow(), 800);
  }, [persistNow]);

  const applyFiles = useCallback((updater) => {
    const next = typeof updater === "function" ? updater(filesRef.current) : updater;
    filesRef.current = next;
    setFiles(next);
    scheduleSave();
  }, [scheduleSave]);

  const appendAgentLog = useCallback((entry) => {
    const next = [...agentLogRef.current, entry].slice(-200);
    agentLogRef.current = next;
    setAgentLog(next);
    scheduleSave();
  }, [scheduleSave]);

  const loadProject = useCallback(async () => {
    try {
      const list = await base44.entities.CodespaceProject.list("-updated_date", 1);
      let proj = list && list[0];
      if (!proj) {
        proj = await base44.entities.CodespaceProject.create(newProject("my-codespace"));
      }
      projectIdRef.current = proj.id;
      const pf = Array.isArray(proj.files) && proj.files.length ? proj.files : newProject().files;
      filesRef.current = pf;
      setFiles(pf);
      const al = Array.isArray(proj.agent_log) ? proj.agent_log : [];
      agentLogRef.current = al;
      setAgentLog(al);
      const firstWs = workspaceFiles(pf)[0];
      setActivePath(proj.active_path || (firstWs ? firstWs.path : ""));
      if (proj.companion_id) setCompanionId(proj.companion_id);
    } catch (e) {
      console.error("Codespace load failed", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProject();
    base44.entities.Character.list("-updated_date", 100)
      .then((cs) => setCharacters(cs || []))
      .catch(() => setCharacters([]));
  }, [loadProject]);

  // Default the companion to the first available character.
  useEffect(() => {
    if (!companionId && characters.length) {
      setCompanionId(characters[0].id);
      scheduleSave();
    }
  }, [characters, companionId, scheduleSave]);

  // ---- console capture from the web preview ------------------------------
  useEffect(() => {
    const onMessage = (e) => {
      if (!isPreviewMessage(e)) return;
      const entry = { level: e.data.level || "log", text: e.data.text };
      setConsoleLogs((prev) => [...prev, entry].slice(-300));
      if (runBufferRef.current) runBufferRef.current.push(entry);
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const pushLog = useCallback((entry) => {
    setConsoleLogs((prev) => [...prev, entry].slice(-300));
  }, []);

  // ---- virus-battle run gate ---------------------------------------------
  const requestBattle = useCallback((scan) => {
    setBattle(scan);
    return new Promise((resolve) => { gateRef.current = resolve; });
  }, []);

  const resolveBattle = useCallback((proceed) => {
    const r = gateRef.current;
    gateRef.current = null;
    setBattle(null);
    r?.(proceed);
  }, []);

  // ---- run a project/file in the sandbox ---------------------------------
  const runCode = useCallback(async (args = {}) => {
    const findFile = (p) => filesRef.current.find((f) => f.path === p);
    let mode = args.mode;
    let path = args.path;
    if (!mode) mode = modeForPath(path || activePath);

    // Build the scan for this run.
    let scan;
    if (mode === "web") {
      const ws = workspaceFiles(filesRef.current);
      const scans = ws
        .filter((f) => /\.(html?|js)$/i.test(f.path))
        .map((f) => scanCode(f.content, f.path));
      scan = mergeScans(scans, "web project");
    } else {
      const f = findFile(path) || findFile(activePath);
      if (!f) return { error: "No file to run." };
      path = f.path;
      scan = scanCode(f.content, f.path);
    }

    // Gate: any flagged code surfaces the NetNavi vs. virus moment. "high"
    // severity is a HARD block — the code never runs from here regardless of the
    // user's click; it must be rewritten until a fresh scan comes back below
    // high. Medium/low are advisory and only need an acknowledgement to run.
    if (scan.findings.length > 0) {
      const proceed = await requestBattle(scan);
      const blocking = scan.maxSeverity === "high";
      if (blocking || !proceed) {
        pushLog({
          level: blocking ? "error" : "warn",
          text: blocking
            ? `Run blocked — ${scan.findings.length} high-severity threat(s) must be neutralized before this can run.`
            : `Run aborted — ${scan.findings.length} threat(s) left unresolved.`,
        });
        return {
          blocked: true,
          reason: blocking
            ? "High-severity threats detected. The code was NOT run. Rewrite the file to remove these patterns, then run again."
            : "User aborted the run at the virus-scan gate.",
          findings: scan.findings.slice(0, 8),
        };
      }
    }

    setBusy(true);
    try {
      if (mode === "web") {
        runSeqRef.current += 1;
        const srcdoc = buildPreviewSrcdoc(filesRef.current) + `\n<!-- run ${runSeqRef.current} -->`;
        runBufferRef.current = [];
        setPreviewSrcdoc(srcdoc);
        setMobileView("preview");
        await delay(1500);
        const logs = runBufferRef.current || [];
        runBufferRef.current = null;
        return {
          ran: true, mode: "web",
          console: logs.map((l) => `[${l.level}] ${l.text}`).slice(0, 60),
        };
      }
      // js / python
      const f = findFile(path);
      if (!f) return { error: "No file to run." };
      setMobileView("console");
      pushLog({ level: "info", text: `▶ Running ${f.path} (${mode})...` });
      const { logs, timedOut } = await runScript({
        language: mode === "python" ? "python" : "js",
        code: f.content,
        onLog: (entry) => pushLog(entry),
      });
      return {
        ran: true, mode, timedOut,
        console: logs.map((l) => `[${l.level}] ${l.text}`).slice(0, 60),
      };
    } finally {
      setBusy(false);
    }
  }, [activePath, pushLog, requestBattle]);

  // ---- tool dispatch for the agent loop ----------------------------------
  const executeTool = useCallback(async (name, args = {}) => {
    const findFile = (p) => filesRef.current.find((f) => f.path === p);
    switch (name) {
      case "list_files":
        return { files: filesRef.current.map((f) => f.path) };
      case "read_file": {
        const f = findFile(args.path);
        return f ? { path: f.path, content: f.content } : { error: "File not found." };
      }
      case "write_file": {
        const path = String(args.path || "").trim();
        if (!path) return { error: "A file path is required." };
        applyFiles((prev) => {
          const idx = prev.findIndex((f) => f.path === path);
          if (idx === -1) return [...prev, { path, content: args.content || "" }];
          const next = prev.slice();
          next[idx] = { ...next[idx], content: args.content || "" };
          return next;
        });
        if (!isSessionPath(path)) setActivePath(path);
        return { ok: true, path };
      }
      case "delete_file": {
        const path = String(args.path || "");
        applyFiles((prev) => prev.filter((f) => f.path !== path));
        return { ok: true, path };
      }
      case "scan_code": {
        const f = findFile(args.path);
        if (!f) return { error: "File not found." };
        const s = scanCode(f.content, f.path);
        return { path: f.path, maxSeverity: s.maxSeverity, safe: s.safe, findings: s.findings };
      }
      case "run_code":
        return runCode(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }, [applyFiles, runCode]);

  const { running, runGoal, stop } = useCodespaceAgent({
    character: companion,
    executeTool,
    getFiles: () => filesRef.current,
    onAssistantMessage: (text) => appendAgentLog({ type: "msg", role: "assistant", content: text }),
    onToolEvent: (ev) => {
      if (ev.status === "done") {
        appendAgentLog({ type: "tool", name: ev.name, detail: ev.args?.path || "" });
      }
    },
    onError: (msg) => {
      appendAgentLog({ type: "msg", role: "assistant", content: `⚠ ${msg}` });
      pushLog({ level: "error", text: msg });
    },
  });

  const handleSend = useCallback((goal) => {
    appendAgentLog({ type: "msg", role: "user", content: goal });
    setAgentOpen(true);
    runGoal(goal);
  }, [appendAgentLog, runGoal]);

  // Adopt remote changes only when there are no unsaved local edits, no run in
  // flight, and the agent isn't mid-build — so cross-device sync never clobbers
  // in-progress work.
  useStoreSync(() => {
    if (!dirtyRef.current && !busy && !running) loadProject();
  });

  // ---- file/session actions ----------------------------------------------
  const activeFile = files.find((f) => f.path === activePath && !isSessionPath(f.path));

  const handleSelect = useCallback((path) => {
    if (isSessionPath(path)) return;
    setActivePath(path);
    setMobileView("code");
    setExplorerOpen(false);
  }, []);

  const handleCreate = useCallback((name) => {
    if (filesRef.current.some((f) => f.path === name)) {
      setActivePath(name);
      return;
    }
    applyFiles((prev) => [...prev, { path: name, content: "" }]);
    setActivePath(name);
    setMobileView("code");
  }, [applyFiles]);

  const handleDelete = useCallback((path) => {
    applyFiles((prev) => prev.filter((f) => f.path !== path));
    if (activePath === path) {
      const remaining = workspaceFiles(filesRef.current);
      setActivePath(remaining[0] ? remaining[0].path : "");
    }
  }, [applyFiles, activePath]);

  const handleEdit = useCallback((value) => {
    if (!activePath) return;
    applyFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === activePath);
      if (idx === -1) return prev;
      const next = prev.slice();
      next[idx] = { ...next[idx], content: value };
      return next;
    });
  }, [applyFiles, activePath]);

  const handleSaveSession = useCallback(() => {
    const label = window.prompt("Label this session (optional)") || "";
    const snap = makeSessionSnapshot(filesRef.current, agentLogRef.current, label);
    applyFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === snap.path);
      if (idx === -1) return [...prev, snap];
      const next = prev.slice();
      next[idx] = snap;
      return next;
    });
    pushLog({ level: "info", text: `Session saved to ${snap.path}` });
  }, [applyFiles, pushLog]);

  const handleRestoreSession = useCallback((path) => {
    const f = filesRef.current.find((x) => x.path === path);
    if (!f) return;
    const parsed = parseSessionSnapshot(f.content);
    if (!parsed) {
      pushLog({ level: "error", text: `Could not read session ${path}` });
      return;
    }
    const sessions = filesRef.current.filter((x) => isSessionPath(x.path));
    applyFiles([...parsed.files, ...sessions]);
    agentLogRef.current = parsed.agentLog;
    setAgentLog(parsed.agentLog);
    const firstWs = parsed.files[0];
    setActivePath(firstWs ? firstWs.path : "");
    setMobileView("code");
    setExplorerOpen(false);
    pushLog({ level: "info", text: `Restored session from ${path} — continue where you left off.` });
  }, [applyFiles, pushLog]);

  const handleRun = useCallback(() => { runCode({ path: activePath }); }, [runCode, activePath]);

  const handleRefreshPreview = useCallback(() => {
    runSeqRef.current += 1;
    setPreviewSrcdoc(buildPreviewSrcdoc(filesRef.current) + `\n<!-- run ${runSeqRef.current} -->`);
  }, []);

  // ---- render ------------------------------------------------------------
  const renderExplorer = () => (
    <FileExplorer
      files={files}
      activePath={activePath}
      onSelect={handleSelect}
      onCreate={handleCreate}
      onDelete={handleDelete}
      onRestoreSession={handleRestoreSession}
      onSaveSession={handleSaveSession}
    />
  );

  if (loading) {
    return (
      <div className="flex-1 min-h-0 grid place-items-center bg-[#06060d]">
        <Loader2 className="w-6 h-6 text-primary/60 animate-spin" />
      </div>
    );
  }

  const TABS = [
    { id: "code", label: "Code", Icon: FileCode2 },
    { id: "preview", label: "Preview", Icon: Globe },
    { id: "console", label: "Console", Icon: TerminalIcon },
  ];

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-[#06060d] text-primary">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-primary/15 bg-[#090912]">
        <button
          onClick={() => setExplorerOpen(true)}
          className="lg:hidden text-primary/50 hover:text-primary"
          title="Files"
        >
          <PanelLeft className="w-4 h-4" />
        </button>
        <span className="font-mono text-[11px] tracking-[0.25em] uppercase text-primary/70 hidden sm:inline">
          // Codespace
        </span>
        <select
          value={companionId || ""}
          onChange={(e) => { setCompanionId(e.target.value); scheduleSave(); }}
          className="bg-black/50 border border-primary/20 text-primary/80 font-mono text-[10px] px-2 py-1 focus:outline-none focus:border-primary/50 max-w-[140px]"
          title="Companion (build agent)"
        >
          {characters.length === 0 && <option value="">No companions</option>}
          {characters.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>

        {/* mobile view tabs */}
        <div className="flex lg:hidden ml-auto">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setMobileView(id)}
              className={`flex items-center gap-1 px-2 py-1 font-mono text-[9px] tracking-widest uppercase border-b-2 transition-colors ${
                mobileView === id ? "border-primary text-primary" : "border-transparent text-primary/40"
              }`}
            >
              <Icon className="w-3 h-3" /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1.5 ml-auto lg:ml-0 lg:flex-1 lg:justify-end">
          <button
            onClick={handleRun}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Run the active file / project"
          >
            {busy ? <Cpu className="w-3.5 h-3.5 animate-pulse" /> : <Play className="w-3.5 h-3.5" />}
            Run
          </button>
          <button
            onClick={handleSaveSession}
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Save a session snapshot into .sessions/"
          >
            <Save className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Session</span>
          </button>
          <button
            onClick={() => setAgentOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 border font-mono text-[10px] tracking-[0.15em] uppercase transition-all ${
              agentOpen || running
                ? "border-primary text-primary bg-primary/10"
                : "border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40"
            }`}
            title="Toggle the companion build agent"
          >
            <Bot className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Agent</span>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 min-h-0 flex">
        {/* Explorer (desktop) */}
        <div className="hidden lg:flex lg:w-52 flex-shrink-0">{renderExplorer()}</div>

        {/* Main */}
        <div className="flex-1 min-h-0 flex flex-col lg:flex-row">
          {/* Code + Console column */}
          <div className={`flex-1 min-h-0 flex-col ${mobileView === "preview" ? "hidden lg:flex" : "flex"}`}>
            {/* code */}
            <div className={`flex-1 min-h-0 flex-col ${mobileView === "console" ? "hidden lg:flex" : "flex"}`}>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#090912] border-b border-primary/10">
                <FileCode2 className="w-3 h-3 text-primary/50" />
                <span className="font-mono text-[10px] text-primary/60 truncate">
                  {activePath || "no file selected"}
                </span>
              </div>
              {activeFile ? (
                <CodeEditor path={activeFile.path} value={activeFile.content} onChange={handleEdit} />
              ) : (
                <div className="flex-1 grid place-items-center bg-[#06060d]">
                  <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                    Select or create a file
                  </p>
                </div>
              )}
            </div>
            {/* console */}
            <div className={`min-h-0 lg:h-44 lg:flex-none lg:border-t lg:border-primary/15 ${
              mobileView === "console" ? "flex flex-1" : "hidden lg:flex"
            }`}>
              <div className="flex-1 min-h-0">
                <ConsolePane logs={consoleLogs} onClear={() => setConsoleLogs([])} />
              </div>
            </div>
          </div>

          {/* Preview column */}
          <div className={`min-h-0 lg:w-[40%] lg:border-l lg:border-primary/15 ${
            mobileView === "preview" ? "flex flex-1" : "hidden lg:flex"
          }`}>
            <div className="flex-1 min-h-0">
              <PreviewPane srcdoc={previewSrcdoc} onRefresh={handleRefreshPreview} />
            </div>
          </div>
        </div>
      </div>

      {/* Explorer drawer (mobile) */}
      <AnimatePresence>
        {explorerOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1100] bg-black/70 lg:hidden"
              onClick={() => setExplorerOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }} animate={{ x: 0 }} exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed inset-y-0 left-0 z-[1101] w-64 lg:hidden"
            >
              {renderExplorer()}
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Agent drawer */}
      <AnimatePresence>
        {agentOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="fixed inset-0 z-[1100] bg-black/60"
              onClick={() => setAgentOpen(false)}
            />
            <motion.div
              initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
              className="fixed inset-y-0 right-0 z-[1101] w-full max-w-sm"
            >
              <AgentPanel
                companion={companion}
                log={agentLog}
                running={running}
                onSend={handleSend}
                onStop={stop}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <VirusBattleModal
        open={Boolean(battle)}
        scan={battle}
        companionName={companion?.name}
        onNeutralize={() => resolveBattle(true)}
        onCancel={() => resolveBattle(false)}
      />
    </div>
  );
}
