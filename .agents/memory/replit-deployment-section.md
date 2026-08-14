---
name: .replit deployment section loss on publish
description: Publish fails with ".replit is missing the deployment section" after the gitignored .replit is regenerated; agent cannot edit it, user must.
---

# `.replit is missing the deployment section` publish failure

**Symptom:** Publish build runs fine — both artifacts compile and prerender — then the
last build-log line is `error: .replit is missing the deployment section` and the build
status is `failed`. The previously-live build keeps serving; `getDeploymentInfo` still
reports the correct `deploymentType`/custom domain because that metadata lives
server-side, not in the file.

**Root cause:** `.replit` is **gitignored** (`.gitignore` line ~4) and platform-managed.
If a commit or action deletes the file, the platform regenerates a *minimal* `.replit`
that drops the `[deployment]` table (and `stack = "PNPM_WORKSPACE"` under `[agent]`).
The publish build pipeline validates `.replit` at the end and requires the `[deployment]`
table even in pnpm multi-artifact mode (artifact builds themselves read each
`artifact.toml`, so they still succeed — only the final validation fails).

**Why:** seen 2026-06-05 — a user commit "Added mcp.json" deleted `.replit`; the
regenerated file lost `[deployment]` and `stack`, so every subsequent publish failed at
validation while the artifact builds passed.

**The agent CANNOT fix this.** `.replit` edits are blocked for the agent at BOTH the
`edit` tool AND the shell (`cat >>` returns "Direct edits to .replit ... are not
allowed"). There is no `deployConfig`/`setDeploymentConfig` callback registered. The
only writer is the user (the guard is agent-specific) or the Deployments pane.

**How to apply / fix:** Tell the user to open `.replit` (file tree → Show hidden files)
and restore the top-level section that prior working builds had:
```toml
[deployment]
router = "application"
deploymentTarget = "autoscale"

[deployment.postBuild]
args = ["pnpm", "store", "prune"]
env = { "CI" = "true" }
```
Also recommend `stack = "PNPM_WORKSPACE"` under `[agent]` to match the original
workspace config. Then re-publish. Diagnose via `getDeploymentBuild({buildId})` and read
the LAST log line (errors are at the very end, after the chunk list / prerender output).
