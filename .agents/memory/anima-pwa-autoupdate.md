---
name: Anima auto-update PWA
description: How the service worker is configured so deploys auto-apply, and why it must not precache HTML
---

# Anima auto-updating service worker

The app uses `vite-plugin-pwa` (`registerType: "autoUpdate"`) + `registerSW({ immediate: true })`
so installed/home-screen users pick up new deploys automatically (no delete +
re-add of the app).

## Rule: precache only content-hashed assets, never HTML; disable navigateFallback

`workbox.globPatterns` excludes `html`, and `workbox.navigateFallback: null`
disables the plugin's default `index.html` fallback. The HTML document is always
fetched from the network.

**Why:** the build is `vite build && node scripts/prerender.mjs` — prerender
rewrites `dist/public/index.html` (route `/`) and emits route HTML *after* vite
build. The SW precache manifest is generated *during* vite build, so a precached
HTML revision is computed from pre-prerender content and can drift from what
actually ships → SW serves a stale shell. Also, with HTML left out of the
precache, the default `navigateFallback: "index.html"` would bind to a
non-precached URL and throw at runtime — hence `navigateFallback: null`.

**How to apply:** auto-update still works because every code change alters a
hashed asset filename → the precache manifest changes → the SW updates,
`skipWaiting`/`clientsClaim`, and `autoUpdate` reloads onto the fresh build (the
network-fetched HTML then points at the new hashes). Trade-off: no offline SPA
fallback (acceptable — goal is update propagation, not offline).

## Gotchas

- `virtual:pwa-register` needs `workbox-window` installed or the build fails to
  resolve the client register module.
- `emblem.png` (~2.4 MB) exceeds Workbox's 2 MiB default; raised
  `maximumFileSizeToCacheInBytes` so it precaches (Workbox only re-fetches
  precache entries whose content changed, so it downloads once across deploys).
- One-time caveat: users who installed the app *before* SW support need one
  online launch to register the SW; after that, deploys auto-apply.
- Prod `BASE_PATH` is `/`, so manifest `start_url`/`scope: "/"` is correct. If a
  non-root base path is ever used, make those base-path aware.
