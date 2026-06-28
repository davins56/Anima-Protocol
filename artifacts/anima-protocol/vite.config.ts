import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    // Auto-updating service worker. Once installed, every new deploy is picked
    // up automatically: the regenerated precache manifest triggers a SW update,
    // which skips waiting, claims open clients, and reloads them onto the fresh
    // build — so installed/home-screen users no longer need to remove and
    // re-add the app to see changes. Kept deliberately minimal: precache the
    // built assets only, no navigation fallback or runtime caching, so it never
    // intercepts /api calls or the prerendered route HTML. Disabled in dev to
    // avoid interfering with HMR. The existing public/manifest.json is reused
    // (manifest: false), and registration happens in src/main.jsx.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: false,
      workbox: {
        // Precache only content-hashed build assets — never HTML. The post-build
        // prerender step (scripts/prerender.mjs) rewrites index.html and emits
        // route HTML *after* vite build, so any precached HTML revision would be
        // computed from pre-prerender content and could drift from what ships.
        // Instead the HTML document is always fetched from the network (fresh,
        // pointing at the latest hashed assets), and only immutable assets are
        // precached. A new deploy changes those asset hashes → the precache
        // manifest changes → the SW updates and reloads onto the new build.
        globPatterns: [
          "**/*.{js,css,svg,png,ico,webp,woff,woff2,jpg,jpeg}",
        ],
        // vite-plugin-pwa defaults navigateFallback to index.html; disable it so
        // the SW never serves a (potentially stale, un-precached) HTML shell for
        // navigations. Document requests always go to the network.
        navigateFallback: null,
        // emblem.png is ~2.4 MB, above Workbox's 2 MiB default. Raise the cap
        // so it is precached and version-consistent; Workbox only re-downloads
        // precache entries whose content actually changed, so it is fetched
        // once and reused across deploys.
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets",
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    // Forward API calls to the api-server during local dev. The api-server
    // binds directly on localhost:8080 (PORT=8080) and serves everything under
    // /api. Override the target with API_PROXY_TARGET if the backend moves.
    // changeOrigin keeps the Host header consistent; SSE streams (chat replies
    // and store sync) pass through unbuffered.
    proxy: {
      "/api": {
        target: process.env.API_PROXY_TARGET || "http://localhost:8080",
        changeOrigin: true,
      },
    },
    fs: {
      strict: false,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
