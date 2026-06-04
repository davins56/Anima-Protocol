---
name: Anima Codespace run gate & sandbox
description: Security/design rules for the companion Codespace (in-browser code workspace) — the run gate and isolation invariants.
---

# Anima Codespace

A VS Code–style in-app workspace where companions agentically build & run code.
Page `pages/Codespace.jsx`; libs `lib/codespace/*`; UI `components/codespace/*`;
backend `codespaceAgentStep` in api-server. Persisted via the generic store
entity `CodespaceProject` (no schema change — Proxy entity). Sessions are JSON
snapshots saved as files under `.sessions/` in the virtual file tree.

## Run gate is a HARD block on high severity
`runCode()` scans before running. **maxSeverity "high" must NEVER execute from
the gate** — even if the user clicks the modal's primary button, return
`{blocked:true}`. The code must be rewritten until a fresh scan is below high.
Medium/low are advisory: they only need an acknowledgement to run.
**Why:** an earlier version let "Neutralize & Run" execute high-severity code
(network/exfil/eval patterns), defeating the safety control. The modal's
blocking action is therefore labeled "Patch It (won't run)".
**How to apply:** any change to the gate must keep: high => always blocked;
the agent loop relies on the `{blocked, reason}` result to rewrite and re-run.

## Sandbox isolation invariants (don't weaken)
- Web preview iframe: `sandbox="allow-scripts"` only — NO `allow-same-origin`
  (opaque origin, can't read parent cookies/storage/Clerk/DOM). Console comes
  back via `postMessage` tagged with the preview token.
- JS/Python run in a Web Worker from a Blob URL (no DOM, hard-killed on timeout).
  Python uses Pyodide from CDN at runtime (no bundled dep).
- **The worker is SAME-ORIGIN**, so the scanner is NOT the boundary — the real
  boundary is `hardenGlobalScope(self)` in sandbox.js, which replaces
  fetch/XHR/WebSocket/EventSource/importScripts/Request/sendBeacon with throwing
  stubs (non-configurable getters) BEFORE user code runs. Without this, user code
  (incl. Python via the `js` bridge / pyfetch) could call the app's own /api/*
  with the user's ambient session. **Why:** code review rejected the worker-only
  version as an exfil path. **How to apply:** for JS, harden at top of worker
  source; for Python, harden AFTER `loadPyodide` (it needs importScripts to
  bootstrap) but BEFORE `runPythonAsync`. Never add allow-same-origin to run
  contexts. hardenGlobalScope is exported + unit-tested (sandbox.test.js).
- Scanner promotes ALL network/exfil to `high` (hard-block) in both languages:
  JS dynamic `import()`, Python `requests/urllib/http.client/httpx/aiohttp/
  pyfetch/socket`. Python in-memory `open()` is only `low` (MEMFS, advisory).

## Sync must not clobber in-progress work
`useStoreSync` reload is guarded by `!dirtyRef.current && !busy && !running`
(unsaved edits / active run / agent build). Anything that reads `running` during
render must come AFTER the `useCodespaceAgent` hook (TDZ) — the sync hook is
placed after it on purpose.

## Self-debug / self-repair surfaces
Two surfaces let the companion recover from failure:
- **Codespace run→fix loop:** `runCode()` returns a UNIFORM result shape at
  EVERY exit — `{ok, errors}` (plus `ran`) — including the virus-scan blocked
  branch and the no-file branches. **Why:** the agent loop + server prompt rule
  ("repeat until ok:true") is only deterministic if no run path can return a
  shape missing `ok`/`errors`. **How to apply:** if you add a return to
  `runCode`, give it `{ok:false, errors:[reason]}` and set `lastRun`; the amber
  Repair toolbar button shows whenever `lastRun && !lastRun.ok` and hands the
  failing file + errors to `runGoal` via `buildRepairGoal` (pure helpers in
  `lib/codespace/repair.js`).
- **App ErrorBoundary silent-first auto-heal:** the FIRST render crash is silent
  (renders a subtle "Re-syncing" indicator, NOT the alarm panel), schedules one
  remount via `recoverKey` after ~700ms, and only shows the panel if the retry
  also fails (`attempts >= 1`). **Why:** most crashes are transient; healing
  under a quiet indicator beats flashing an alarm. **How to apply (tests):**
  React 18 `createRoot` does a SYNCHRONOUS render retry, so a child that throws
  exactly once heals before the boundary ever commits the error — to trip the
  boundary you need an EXTERNAL flag that stays true across those retries; drive
  the 700ms window with fake timers (`advanceTimersByTime`).
