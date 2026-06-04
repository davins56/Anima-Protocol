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

## Sync must not clobber in-progress work
`useStoreSync` reload is guarded by `!dirtyRef.current && !busy && !running`
(unsaved edits / active run / agent build). Anything that reads `running` during
render must come AFTER the `useCodespaceAgent` hook (TDZ) — the sync hook is
placed after it on purpose.
