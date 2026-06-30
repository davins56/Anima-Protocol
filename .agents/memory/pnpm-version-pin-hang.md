---
name: pnpm packageManager pin hangs local pnpm
description: Why every local pnpm command (install + workflows) hangs in this repl, and the .npmrc fix that unblocks it without breaking Vercel.
---

# pnpm `packageManager` pin causes local self-switch hang

Root `package.json` carries `"packageManager": "pnpm@10.15.1"`. This Replit env ships a different pnpm (e.g. 10.26.1). With pnpm's default `manage-package-manager-versions=true`, every pnpm invocation tries to self-install the pinned version (`pnpm add pnpm@10.15.1 ...`), which cannot be fetched in the sandbox → the command hangs / aborts with SIGABRT. This breaks `pnpm install`, `pnpm --filter ... run build/test`, AND the dev **workflows** (they all shell out to pnpm), so workflows fail to start with repeated `Command failed ... pnpm add pnpm@10.15.1`.

**Fix (in repo):** add `manage-package-manager-versions=false` to the root `.npmrc`.
**Why:** it's a no-op on Vercel (corepack invokes the pinned pnpm directly, which already matches the `packageManager` field) but stops local pnpm from trying to switch. Keep the `packageManager` pin — do NOT remove it; environments that honor it (Vercel/corepack) still want it.

**How to apply:** if you see workflows or installs hanging with `pnpm add pnpm@<ver>` errors, check the pin vs `pnpm --version`; the `.npmrc` flag is the durable fix. For one-off shell commands you can also prefix `env npm_config_manage_package_manager_versions=false pnpm ...`, but the `.npmrc` line fixes workflows too.
