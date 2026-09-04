import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Play, Save, PanelLeft, Bot, FileCode2, Loader2, Cpu, Terminal as TerminalIcon, Globe, Wrench, Bug,
  FolderInput, Upload, GitPullRequest,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { base44 } from "@/api/base44Client";
import { useStoreSync } from "@/lib/useStoreSync";
import { whenBootstrapReady } from "@/lib/syncBootstrap";
import FileExplorer from "@/components/codespace/FileExplorer";
import CodeEditor from "@/components/codespace/CodeEditor";
import PreviewPane from "@/components/codespace/PreviewPane";
import ConsolePane from "@/components/codespace/ConsolePane";
import VirusBattleModal from "@/components/codespace/VirusBattleModal";
import ImportRepoModal from "@/components/codespace/ImportRepoModal";
import AgentPanel from "@/components/codespace/AgentPanel";
import { scanCode, severityRank } from "@/lib/codespace/codeScanner";
import { buildPreviewSrcdoc, isPreviewMessage, runScript } from "@/lib/codespace/sandbox";
import {
  newProject, emptyRepoProject, pickCodespaceProject, makeSessionSnapshot,
  parseSessionSnapshot, languageForPath, isSessionPath, workspaceFiles, sessionFiles,
} from "@/lib/codespace/projectModel";
import { useCodespaceAgent } from "@/lib/codespace/useCodespaceAgent";
import { summarizeRunErrors, buildRepairGoal } from "@/lib/codespace/repair";
import { JULES_PERSONA, debugAndTroubleshoot } from "@/lib/codespace/julesApi";
import {
  importFromBrowserFiles,
  importFromZipFile,
  mergeImportedFiles,
  summarizeImport,
} from "@/lib/codespace/importProject";
import { pullGithubRepo } from "@/lib/codespace/pullGithubRepo";
import {
  probeRepoFilesystem,
  listRepoFiles,
  readRepoFile,
  writeRepoFile,
  deleteRepoFile,
} from "@/lib/codespace/repoApi";
import { listPersonalAnimas } from "@/lib/listPersonalAnimas";
import {
  buildCodespaceCompanions,
  companionPickerLabel,
  resolveCodespaceCompanionId,
} from "@/lib/codespace/companionPicker";

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

export default function Codespace({ isRepoMode = false }) {
  const [searchParams] = useSearchParams();
  const requestedAnimaId = searchParams.get("anima");
  const [files, setFiles] = useState([]);
  const [activePath, setActivePath] = useState("");
  const [consoleLogs, setConsoleLogs] = useState([]);
  const [previewSrcdoc, setPreviewSrcdoc] = useState("");
  const [characters, setCharacters] = useState([]);
  const [personalAnimas, setPersonalAnimas] = useState([]);
  const [me, setMe] = useState(null);
  const [companionId, setCompanionId] = useState(JULES_PERSONA.id);
  const [agentLog, setAgentLog] = useState([]);
  const [battle, setBattle] = useState(null);
  const [mobileView, setMobileView] = useState("code"); // code | preview | console
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [workspaceModal, setWorkspaceModal] = useState(null); // "import" | "pull" | null
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [repoLive, setRepoLive] = useState(false);
  const [repoUnavailable, setRepoUnavailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Outcome of the most recent run, so a failed run can offer self-repair.
  const [lastRun, setLastRun] = useState(null);

  const filesRef = useRef([]);
  const agentLogRef = useRef([]);
  const projectIdRef = useRef(null);
  const runBufferRef = useRef(null);
  const runSeqRef = useRef(0);
  const gateRef = useRef(null);
  const saveTimerRef = useRef(null);
  const dirtyRef = useRef(false);
  const repoLiveRef = useRef(false);
  const dirtyRepoPathsRef = useRef(new Set());
  const toolbarUploadRef = useRef(null);
  const savedCompanionIdRef = useRef(null);
  const resolvedCompanionRef = useRef(false);
  const userPickedCompanionRef = useRef(false);
  const [projectLoaded, setProjectLoaded] = useState(false);
  const [rosterLoaded, setRosterLoaded] = useState(false);

  const availableCompanions = useMemo(
    () => buildCodespaceCompanions({ animas: personalAnimas, characters }),
    [personalAnimas, characters],
  );
  const companion = availableCompanions.find((c) => c.id === companionId) || JULES_PERSONA;

  // ---- persistence -------------------------------------------------------
  const persistNow = useCallback(async () => {
    if (repoLiveRef.current) {
      const dirty = [...dirtyRepoPathsRef.current];
      dirtyRepoPathsRef.current = new Set();
      for (const p of dirty) {
        if (isSessionPath(p)) continue;
        const f = filesRef.current.find((x) => x.path === p);
        if (!f) continue;
        const written = await writeRepoFile(p, f.content ?? "");
        if (!written.ok) {
          dirtyRepoPathsRef.current.add(p);
          console.error("Codespace live write failed", written.error);
        }
      }
    }
    if (!projectIdRef.current) return;
    try {
      await base44.entities.CodespaceProject.update(projectIdRef.current, {
        files: repoLiveRef.current
          ? sessionFiles(filesRef.current)
          : filesRef.current,
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

  const applyFiles = useCallback((updater, { persist = true } = {}) => {
    const prev = filesRef.current;
    const next = typeof updater === "function" ? updater(prev) : updater;
    filesRef.current = next;
    setFiles(next);
    if (repoLiveRef.current && persist) {
      const prevMap = new Map(prev.map((f) => [f.path, f.content]));
      for (const f of next) {
        if (!f?.path || isSessionPath(f.path)) continue;
        if (prevMap.get(f.path) !== f.content) dirtyRepoPathsRef.current.add(f.path);
      }
    }
    if (persist) scheduleSave();
  }, [scheduleSave]);

  const appendAgentLog = useCallback((entry) => {
    const next = [...agentLogRef.current, entry].slice(-200);
    agentLogRef.current = next;
    setAgentLog(next);
    scheduleSave();
  }, [scheduleSave]);

  const loadProject = useCallback(async () => {
    try {
      const list = await base44.entities.CodespaceProject.list("-updated_date", 20);
      let proj = pickCodespaceProject(list, { isRepoMode });
      if (!proj) {
        proj = await base44.entities.CodespaceProject.create(
          isRepoMode ? emptyRepoProject() : newProject("my-codespace"),
        );
      }
      projectIdRef.current = proj.id;
      const storedFiles = Array.isArray(proj.files) ? proj.files : [];
      const al = Array.isArray(proj.agent_log) ? proj.agent_log : [];
      agentLogRef.current = al;
      setAgentLog(al);
      savedCompanionIdRef.current = proj.companion_id || null;

      if (isRepoMode) {
        const status = await probeRepoFilesystem();
        if (status.available) {
          const listed = await listRepoFiles();
          if (listed.ok) {
            repoLiveRef.current = true;
            setRepoLive(true);
            setRepoUnavailable(false);
            const sessions = sessionFiles(storedFiles);
            const mapped = (listed.files || [])
              .filter((f) => f && !f.isDirectory && f.path)
              .map((f) => ({ path: f.path, content: "", loaded: false }));
            const merged = [...mapped, ...sessions];
            filesRef.current = merged;
            setFiles(merged);
            const firstWs = mapped[0];
            const keepActive = proj.active_path
              && mapped.some((f) => f.path === proj.active_path);
            setActivePath(keepActive ? proj.active_path : (firstWs ? firstWs.path : ""));
            return;
          }
        }
        repoLiveRef.current = false;
        setRepoLive(false);
        setRepoUnavailable(true);
      } else {
        repoLiveRef.current = false;
        setRepoLive(false);
        setRepoUnavailable(false);
      }

      const pf = storedFiles.length
        ? storedFiles
        : (isRepoMode ? [] : newProject().files);
      filesRef.current = pf;
      setFiles(pf);
      const firstWs = workspaceFiles(pf)[0];
      setActivePath(proj.active_path || (firstWs ? firstWs.path : ""));
    } catch (e) {
      console.error("Codespace load failed", e);
    } finally {
      setProjectLoaded(true);
      setLoading(false);
    }
  }, [isRepoMode]);

  const loadRoster = useCallback(async () => {
    try {
      const [cs, animas, profile] = await Promise.all([
        base44.entities.Character.list("-updated_date", 100).catch(() => []),
        listPersonalAnimas(100).catch(() => []),
        base44.auth.me().catch(() => null),
      ]);
      setCharacters(cs || []);
      setPersonalAnimas(animas || []);
      setMe(profile);
    } catch {
      setCharacters([]);
      setPersonalAnimas([]);
    } finally {
      setRosterLoaded(true);
    }
  }, []);

  useEffect(() => {
    loadProject();
    loadRoster();
    whenBootstrapReady().then(() => loadRoster());
  }, [loadProject, loadRoster]);

  useStoreSync(loadRoster);

  useEffect(() => {
    if (!projectLoaded || !rosterLoaded) return;
    setCompanionId((current) => {
      const next = resolveCodespaceCompanionId({
        savedId: savedCompanionIdRef.current,
        requestedId: requestedAnimaId,
        animas: personalAnimas,
        characters,
        me,
      });
      if (!resolvedCompanionRef.current) {
        resolvedCompanionRef.current = true;
        return next;
      }
      if (userPickedCompanionRef.current && availableCompanions.some((c) => c.id === current)) {
        return current;
      }
      if (
        current === JULES_PERSONA.id &&
        !savedCompanionIdRef.current &&
        !requestedAnimaId &&
        personalAnimas.length > 0
      ) {
        return next;
      }
      if (availableCompanions.some((c) => c.id === current)) return current;
      return next;
    });
  }, [projectLoaded, rosterLoaded, availableCompanions, personalAnimas, characters, me, requestedAnimaId]);

  useEffect(() => {
    if (!resolvedCompanionRef.current || !projectIdRef.current) return;
    if (companionId && companionId !== savedCompanionIdRef.current) {
      savedCompanionIdRef.current = companionId;
      scheduleSave();
    }
  }, [companionId, scheduleSave]);

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
      if (!f) {
        const reason = "No file to run.";
        setLastRun({ path: path || activePath, mode, ok: false, errors: [reason] });
        return { ran: false, ok: false, errors: [reason], error: reason };
      }
      path = f.path;
      scan = scanCode(f.content, f.path);
    }

    // Gate: any flagged code surfaces the NetNavi vs. virus moment.
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
        if (blocking) {
          setLastRun({
            path: mode === "web" ? "index.html" : path || activePath,
            mode,
            ok: false,
            errors: [
              `Blocked by virus scan — neutralize: ${scan.findings
                .map((f) => f.label)
                .join(", ")}`,
            ],
          });
        } else {
          setLastRun(null);
        }
        const reason = blocking
          ? "High-severity threats detected. The code was NOT run. Rewrite the file to remove these patterns, then run again."
          : "User aborted the run at the virus-scan gate.";
        return {
          ran: false,
          ok: false,
          errors: [reason],
          blocked: true,
          reason,
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
        const { ok, errors } = summarizeRunErrors(logs, false);
        setLastRun({ path: "index.html", mode: "web", ok, errors });
        return {
          ran: true, ok, mode: "web", errors,
          console: logs.map((l) => `[${l.level}] ${l.text}`).slice(0, 60),
        };
      }
      // js / python
      const f = findFile(path);
      if (!f) {
        const reason = "No file to run.";
        setLastRun({ path: path || activePath, mode, ok: false, errors: [reason] });
        return { ran: false, ok: false, errors: [reason], error: reason };
      }
      setMobileView("console");
      pushLog({ level: "info", text: `▶ Running ${f.path} (${mode})...` });
      const { logs, timedOut } = await runScript({
        language: mode === "python" ? "python" : "js",
        code: f.content,
        onLog: (entry) => pushLog(entry),
      });
      const { ok, errors } = summarizeRunErrors(logs, timedOut);
      setLastRun({ path: f.path, mode, ok, errors });
      return {
        ran: true, ok, mode, timedOut, errors,
        console: logs.map((l) => `[${l.level}] ${l.text}`).slice(0, 60),
      };
    } finally {
      setBusy(false);
    }
  }, [activePath, pushLog, requestBattle]);

  const ensureFileLoaded = useCallback(async (path) => {
    if (!path || isSessionPath(path)) return filesRef.current.find((f) => f.path === path) || null;
    const existing = filesRef.current.find((f) => f.path === path);
    if (!repoLiveRef.current) return existing || null;
    if (existing && existing.loaded !== false) return existing;
    const result = await readRepoFile(path);
    if (!result.ok) return null;
    const row = { path, content: result.content ?? "", loaded: true };
    applyFiles((prev) => {
      const idx = prev.findIndex((f) => f.path === path);
      if (idx === -1) return [...prev, row];
      const next = prev.slice();
      next[idx] = { ...next[idx], ...row };
      return next;
    }, { persist: false });
    return row;
  }, [applyFiles]);

  // ---- tool dispatch for the agent loop ----------------------------------
  const executeTool = useCallback(async (name, args = {}) => {
    const findFile = (p) => filesRef.current.find((f) => f.path === p);
    switch (name) {
      case "list_files":
      case "list_repo_files":
        return { files: filesRef.current.map((f) => f.path) };
      case "read_file":
      case "read_repo_file": {
        const loaded = await ensureFileLoaded(args.path);
        return loaded
          ? { path: loaded.path, content: loaded.content }
          : { error: "File not found." };
      }
      case "write_file":
      case "write_repo_file": {
        const path = String(args.path || "").trim();
        if (!path) return { error: "A file path is required." };
        if (path.includes("..")) return { error: "Path traversal is not allowed." };
        if (repoLiveRef.current && !isSessionPath(path)) {
          const written = await writeRepoFile(path, args.content || "");
          if (!written.ok) return { error: written.error || "Live repo write failed." };
        }
        applyFiles((prev) => {
          const idx = prev.findIndex((f) => f.path === path);
          const row = { path, content: args.content || "", loaded: true };
          if (idx === -1) return [...prev, row];
          const next = prev.slice();
          next[idx] = { ...next[idx], ...row };
          return next;
        }, { persist: !repoLiveRef.current || isSessionPath(path) });
        if (!isSessionPath(path)) setActivePath(path);
        return { ok: true, path };
      }
      case "delete_file":
      case "delete_repo_file": {
        const path = String(args.path || "");
        if (repoLiveRef.current && path && !isSessionPath(path)) {
          const removed = await deleteRepoFile(path);
          if (!removed.ok) return { error: removed.error || "Live repo delete failed." };
        }
        applyFiles((prev) => prev.filter((f) => f.path !== path), {
          persist: !repoLiveRef.current || isSessionPath(path),
        });
        return { ok: true, path };
      }
      case "scan_code": {
        const f = await ensureFileLoaded(args.path) || findFile(args.path);
        if (!f) return { error: "File not found." };
        const s = scanCode(f.content, f.path);
        return { path: f.path, maxSeverity: s.maxSeverity, safe: s.safe, findings: s.findings };
      }
      case "run_code":
        return runCode(args);
      default:
        return { error: `Unknown tool: ${name}` };
    }
  }, [applyFiles, ensureFileLoaded, runCode]);

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

  // Jules API automated debug & troubleshoot action
  const handleJulesTroubleshoot = useCallback(async () => {
    pushLog({ level: "info", text: "🔍 Jules API running codespace diagnostic..." });
    const analysis = await debugAndTroubleshoot({
      files: filesRef.current,
      lastRun,
      targetPath: activePath,
    });

    userPickedCompanionRef.current = true;
    setCompanionId(JULES_PERSONA.id);
    appendAgentLog({
      type: "msg",
      role: "user",
      content: `Debug & Troubleshoot requested. ${analysis.summary}`,
    });
    setAgentOpen(true);
    runGoal(analysis.repairGoal);
  }, [lastRun, activePath, pushLog, appendAgentLog, runGoal]);

  // Adopt remote changes only when safe.
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
    applyFiles((prev) => [...prev, { path: name, content: "", loaded: true }]);
    setActivePath(name);
    setMobileView("code");
  }, [applyFiles]);

  const handleDelete = useCallback(async (path) => {
    if (repoLiveRef.current && path && !isSessionPath(path)) {
      const removed = await deleteRepoFile(path);
      if (!removed.ok) {
        pushLog({ level: "error", text: removed.error || "Live repo delete failed." });
        return;
      }
    }
    applyFiles((prev) => prev.filter((f) => f.path !== path), {
      persist: !repoLiveRef.current || isSessionPath(path),
    });
    if (activePath === path) {
      const remaining = workspaceFiles(filesRef.current);
      setActivePath(remaining[0] ? remaining[0].path : "");
    }
  }, [applyFiles, activePath, pushLog]);

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

  const applyImportResult = useCallback((result, { replaceWorkspace }) => {
    if (result.errors?.length) {
      result.errors.forEach((text) => pushLog({ level: "error", text }));
    }
    if (!result.files?.length) {
      const message = result.errors?.[0] || "Import brought in no text files the editor can open.";
      setImportError(message);
      pushLog({ level: "warn", text: message });
      return false;
    }
    applyFiles((prev) => mergeImportedFiles(prev, result.files, { replaceWorkspace }));
    const first = result.files.find((f) => !isSessionPath(f.path));
    if (first) setActivePath(first.path);
    setMobileView("code");
    setExplorerOpen(false);
    pushLog({ level: "info", text: summarizeImport(result) });
    setImportError("");
    return true;
  }, [applyFiles, pushLog]);

  const handleUploadFiles = useCallback(async (fileList) => {
    setImportBusy(true);
    setImportError("");
    try {
      const result = await importFromBrowserFiles(fileList, { mode: "files" });
      applyImportResult(result, { replaceWorkspace: false });
    } catch (err) {
      const message = err?.message || "Could not upload files.";
      setImportError(message);
      pushLog({ level: "error", text: message });
    } finally {
      setImportBusy(false);
    }
  }, [applyImportResult, pushLog]);

  const handleImportFolder = useCallback(async (fileList) => {
    setImportBusy(true);
    setImportError("");
    try {
      const result = await importFromBrowserFiles(fileList, { mode: "folder" });
      if (applyImportResult(result, { replaceWorkspace: true })) setWorkspaceModal(null);
    } catch (err) {
      const message = err?.message || "Could not import the folder.";
      setImportError(message);
      pushLog({ level: "error", text: message });
    } finally {
      setImportBusy(false);
    }
  }, [applyImportResult, pushLog]);

  const handleImportZip = useCallback(async (file) => {
    setImportBusy(true);
    setImportError("");
    try {
      const result = await importFromZipFile(file);
      if (applyImportResult(result, { replaceWorkspace: true })) setWorkspaceModal(null);
    } catch (err) {
      const message = err?.message || "Could not unpack the zip.";
      setImportError(message);
      pushLog({ level: "error", text: message });
    } finally {
      setImportBusy(false);
    }
  }, [applyImportResult, pushLog]);

  const handlePullRepo = useCallback(async (spec) => {
    setImportBusy(true);
    setImportError("");
    try {
      const result = await pullGithubRepo(spec);
      if (applyImportResult(result, { replaceWorkspace: true })) setWorkspaceModal(null);
    } catch (err) {
      const message = err?.message || "Could not pull the GitHub repo.";
      setImportError(message);
      pushLog({ level: "error", text: message });
    } finally {
      setImportBusy(false);
    }
  }, [applyImportResult, pushLog]);

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

  const handleRepair = useCallback(() => {
    if (!lastRun || lastRun.ok || running) return;
    const goal = buildRepairGoal({
      path: lastRun.path,
      mode: lastRun.mode,
      errors: lastRun.errors,
    });
    appendAgentLog({
      type: "msg",
      role: "user",
      content: `Debug & repair ${lastRun.path || "the last run"}`,
    });
    setAgentOpen(true);
    runGoal(goal);
  }, [lastRun, running, appendAgentLog, runGoal]);

  const handleRefreshPreview = useCallback(() => {
    runSeqRef.current += 1;
    setPreviewSrcdoc(buildPreviewSrcdoc(filesRef.current) + `\n<!-- run ${runSeqRef.current} -->`);
  }, []);

  useEffect(() => {
    if (!repoLive || !activePath) return;
    ensureFileLoaded(activePath);
  }, [repoLive, activePath, ensureFileLoaded]);

  const openImport = () => { setImportError(""); setWorkspaceModal("import"); };
  const openPull = () => { setImportError(""); setWorkspaceModal("pull"); };
  const workspaceEmpty = workspaceFiles(files).length === 0;

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
      onUploadFiles={handleUploadFiles}
      onImportRepo={openImport}
      onPullRepo={openPull}
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
    <div className="app-page-fill flex-1 min-h-0 flex flex-col bg-[#06060d] text-primary">
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
          {isRepoMode ? "// Repo Workspace" : "// Codespace"}
        </span>
        <select
          aria-label="Codespace companion"
          value={companionId}
          onChange={(e) => {
            userPickedCompanionRef.current = true;
            setCompanionId(e.target.value);
            scheduleSave();
          }}
          className="bg-black/50 border border-primary/20 text-cyan-300 font-mono text-[10px] px-2 py-1 focus:outline-none focus:border-cyan-500 max-w-[160px]"
          title="Agent Engine persona"
        >
          {availableCompanions.map((c) => (
            <option key={c.id} value={c.id}>
              {companionPickerLabel(c)}
            </option>
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

        <div className="flex items-center gap-1.5 ml-auto lg:ml-0 lg:flex-1 lg:justify-end overflow-x-auto">
          <input
            ref={toolbarUploadRef}
            type="file"
            multiple
            className="hidden"
            data-testid="codespace-toolbar-upload"
            onChange={(e) => {
              const list = Array.from(e.target.files || []);
              e.target.value = "";
              if (list.length) handleUploadFiles(list);
            }}
          />
          <button
            type="button"
            onClick={() => toolbarUploadRef.current?.click()}
            data-testid="codespace-toolbar-upload-btn"
            aria-label="Upload files"
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Upload files into this project"
          >
            <Upload className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Upload</span>
          </button>
          <button
            type="button"
            onClick={openImport}
            data-testid="codespace-toolbar-import"
            aria-label="Import folder or zip"
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-primary/20 text-primary/70 hover:text-primary hover:border-primary/40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Import a repository folder or zip into this project"
          >
            <FolderInput className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Import</span>
          </button>
          <button
            type="button"
            onClick={openPull}
            data-testid="codespace-toolbar-pull"
            aria-label="Pull a GitHub repo"
            className="flex items-center gap-1.5 px-2.5 py-1.5 border border-cyan-500/40 text-cyan-200 hover:bg-cyan-500/10 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Pull a GitHub repository (defaults to davins56/Anima-Protocol)"
          >
            <GitPullRequest className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Pull</span>
          </button>
          <button
            onClick={handleJulesTroubleshoot}
            disabled={running || busy}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-cyan-500/50 text-cyan-300 hover:bg-cyan-500/10 disabled:opacity-40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Use Jules API to directly code, debug, and troubleshoot this codespace"
          >
            <Bug className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Jules Debug</span>
          </button>
          <button
            onClick={handleRun}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-primary/40 text-primary hover:bg-primary/10 disabled:opacity-40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
            title="Run the active file / project"
          >
            {busy ? <Cpu className="w-3.5 h-3.5 animate-pulse" /> : <Play className="w-3.5 h-3.5" />}
            Run
          </button>
          {lastRun && !lastRun.ok && (
            <button
              onClick={handleRepair}
              disabled={running || busy}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-amber-400/50 text-amber-300 hover:bg-amber-400/10 disabled:opacity-40 font-mono text-[10px] tracking-[0.15em] uppercase transition-all"
              title="Have the companion debug and repair the last failed run"
            >
              <Wrench className="w-3.5 h-3.5" /> Repair
            </button>
          )}
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

      {isRepoMode && repoLive && (
        <div className="px-3 py-1.5 border-b border-cyan-500/20 bg-cyan-500/5 font-mono text-[10px] text-cyan-200/80">
          Editing the live Anima Protocol tree on this host. Writes go to /api/repo-codespace.
        </div>
      )}
      {isRepoMode && repoUnavailable && (
        <div
          role="status"
          className="px-3 py-2 border-b border-amber-400/25 bg-amber-500/5 font-mono text-[10px] text-amber-100/85 leading-relaxed"
        >
          Live repository filesystem isn&apos;t on this host (typical on Cloudflare). Pull{" "}
          <span className="text-cyan-200">davins56/Anima-Protocol</span>
          {" "}into the virtual Codespace to edit it here, with your Anima assisting.
          {" "}
          <button
            type="button"
            onClick={openPull}
            className="underline underline-offset-2 text-cyan-200 hover:text-cyan-100"
          >
            Pull Anima Protocol
          </button>
        </div>
      )}

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
              {activeFile && activeFile.loaded === false ? (
                <div className="flex-1 grid place-items-center bg-[#06060d]">
                  <Loader2 className="w-5 h-5 text-primary/50 animate-spin" />
                </div>
              ) : activeFile ? (
                <CodeEditor path={activeFile.path} value={activeFile.content} onChange={handleEdit} />
              ) : (
                <div className="flex-1 grid place-items-center bg-[#06060d] px-6">
                  {workspaceEmpty ? (
                    <div className="text-center space-y-3 max-w-sm">
                      <p className="font-mono text-[11px] tracking-[0.2em] uppercase text-cyan-200">
                        Upload, Import, or Pull a repo
                      </p>
                      <p className="font-mono text-[10px] text-primary/45 leading-relaxed">
                        {isRepoMode
                          ? "This Repo Workspace is for Anima Protocol (or any pulled GitHub repo), not a blank toy project."
                          : "Bring files into this Codespace, then ask your Anima to help edit them."}
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={() => toolbarUploadRef.current?.click()}
                          className="px-3 py-1.5 border border-primary/30 font-mono text-[10px] tracking-[0.15em] uppercase text-primary/80 hover:text-primary hover:border-primary/50"
                        >
                          Upload
                        </button>
                        <button
                          type="button"
                          onClick={openImport}
                          className="px-3 py-1.5 border border-primary/30 font-mono text-[10px] tracking-[0.15em] uppercase text-primary/80 hover:text-primary hover:border-primary/50"
                        >
                          Import
                        </button>
                        <button
                          type="button"
                          onClick={openPull}
                          className="px-3 py-1.5 border border-cyan-500/40 font-mono text-[10px] tracking-[0.15em] uppercase text-cyan-200 hover:bg-cyan-500/10"
                        >
                          Pull
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="font-mono text-[10px] text-primary/30 tracking-widest uppercase">
                      Select or create a file
                    </p>
                  )}
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
                onDebugAndTroubleshoot={handleJulesTroubleshoot}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <ImportRepoModal
        open={Boolean(workspaceModal)}
        variant={workspaceModal === "pull" ? "pull" : "import"}
        busy={importBusy}
        error={importError}
        onClose={() => { if (!importBusy) setWorkspaceModal(null); }}
        onPickFolder={handleImportFolder}
        onPickZip={handleImportZip}
        onPullRepo={handlePullRepo}
      />

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
