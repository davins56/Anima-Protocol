import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { VitePWA } from "vite-plugin-pwa";
import { config as loadEnv } from "dotenv";
import { sanitizeClerkPublishableKey } from "./src/lib/clerkProxy.js";

const repoRoot = path.resolve(import.meta.dirname, "../..");
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(import.meta.dirname, ".env"), override: true });

// Vite only exposes VITE_* to the client. On Vercel, CLERK_PUBLISHABLE_KEY is
// often set without the VITE_ prefix — mirror it so production builds embed the
// correct Clerk instance (avoids host-derived pk_live_ + missing GitHub SSO).
// Never inline pk_test_placeholder: Vite would otherwise bake a key whose
// payload decodes to mojibake and clerk-js would load from a garbled host.
const clerkPublishableKey = sanitizeClerkPublishableKey(
  process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
    process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
    "",
);

// Algolia Netlify indexes are per-git-branch. Netlify injects HEAD at build
// time; expose it to the client so the widget queries the matching index.
const algoliaBranch =
  process.env.VITE_ALGOLIA_BRANCH?.trim() ||
  process.env.HEAD?.trim() ||
  "main";

// Optional build revision for chat failure reports. Empty when the host
// does not inject a commit. Never required for the app to run.
const appCommit = (
  process.env.VITE_APP_COMMIT ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.CF_PAGES_COMMIT_SHA ||
  process.env.WORKERS_CI_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  ""
)
  .trim()
  .slice(0, 64);

const rawPort = process.env.FRONTEND_PORT ?? process.env.PORT ?? "5173";

const port = parseInt(rawPort);

// In CI/build environments (e.g. Vercel build) PORT is often not set.
// We don't need a real listening port during bundling, only a valid number
// for Vite's server/preview config to initialize.
if (Number.isNaN(port) || port <= 0) {
  console.warn(`[vite.config] Invalid PORT value "${rawPort}", falling back to 5173`);
} 

const finalPort = Number.isNaN(port) || port <= 0 ? 5173 : port;

const basePath = process.env.BASE_PATH ?? "/";

// Build environments may not provide BASE_PATH; default to root.
if (typeof basePath !== "string" || !basePath.trim()) {
  console.warn("[vite.config] BASE_PATH missing/invalid, defaulting to '/'");
}
const normalizedBasePath = (basePath || "/").trim().replace(/\/$/, "") + "/";

// Content hash for the precached offline page (see VitePWA below).
const offlinePageRevision = createHash("sha256")
  .update(readFileSync(path.join(import.meta.dirname, "public/offline.html")))
  .digest("hex")
  .slice(0, 16);

const isReplit = process.env.REPL_ID !== undefined;
const runtimeErrorOverlay = isReplit
  ? await import("@replit/vite-plugin-runtime-error-modal")
      .then((m) => m.default)
      .catch(() => null)
  : null;

const replitDevPlugins =
  process.env.NODE_ENV !== "production" && isReplit
    ? await Promise.all([
        import("@replit/vite-plugin-cartographer")
          .then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          )
          .catch(() => null),
        import("@replit/vite-plugin-dev-banner")
          .then((m) => m.devBanner())
          .catch(() => null),
      ]).then((plugins) => plugins.filter(Boolean))
    : [];


export default defineConfig({
  base: normalizedBasePath,

  define: {
    // Always define so a placeholder in the environment cannot be auto-inlined.
    "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY":
      JSON.stringify(clerkPublishableKey),
    "import.meta.env.VITE_ALGOLIA_BRANCH": JSON.stringify(algoliaBranch),
    "import.meta.env.VITE_APP_COMMIT": JSON.stringify(appCommit),
  },
  plugins: [
    react({ jsxRuntime: "automatic" }),
    tailwindcss({ optimize: false }),
    // Replit-only: Clerk load failures are handled in-app (guest landing fallback).
    ...(runtimeErrorOverlay ? [runtimeErrorOverlay()] : []),
    // Service worker with an update prompt. Every new deploy is still picked
    // up without removing/re-adding the home-screen app: the regenerated
    // precache manifest installs a new SW, which then WAITS (no skipWaiting)
    // until the reader taps Reload in UpdateAvailablePrompt — deferred while a
    // reply is streaming (src/lib/swUpdate.js). The old autoUpdate +
    // skipWaiting could reload mid-reply. Kept deliberately minimal:
    // navigations are network-only (`navigateFallback: null`) and hashed
    // /assets/*.js + /assets/*.css are NOT precached, so the SW never
    // intercepts ES module requests. (Workbox precacheAndRoute would otherwise
    // serve those modules from Cache Storage; on Safari/iPad that surfaces as
    // "Importing a module script failed" even when the network response is
    // 200 text/javascript. Hashed assets are already immutable at the HTTP
    // cache, and JS precache cannot help offline because HTML is network-only.)
    // Disabled in dev to avoid interfering with HMR. The existing
    // public/manifest.json is reused (manifest: false), and registration
    // happens in src/main.jsx.
    VitePWA({
      registerType: "prompt",
      injectRegister: false,
      manifest: false,
      workbox: {
        importScripts: ["/push-notifications-sw.js"],
        globDirectory: path.resolve(import.meta.dirname, "dist/public"),
        globPatterns: [
          // Images, fonts, and manifests only. Do not precache JS or CSS —
          // those are ES modules / styles under /assets/* and must be fetched
          // from the network (see runtimeCaching NetworkOnly below).
          "**/*.{svg,png,ico,webp,woff,woff2,jpg,jpeg,json}",
        ],
        // The one HTML file that is precached: the static offline page. It is
        // not a route and prerender never rewrites it, so it cannot go stale
        // the way route HTML would. Revision = content hash.
        additionalManifestEntries: [
          { url: "/offline.html", revision: offlinePageRevision },
        ],
        // Default is index.html. HTML is intentionally not precached (prerender
        // rewrites it after the SW manifest is generated). A fallback to a
        // non-precached document throws, and an old SW would keep serving a
        // shell that imports dead /assets/*.js hashes. Network-only navigations
        // + cleanup of outdated precaches let a new deploy replace those hashes.
        navigateFallback: null,
        navigateFallbackDenylist: [/^\/api(?:\/|$)/, /^\/assets(?:\/|$)/],
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // Navigations stay network-only (same as before), but when the
            // network is down the reader gets a clear offline page instead
            // of the browser's error screen.
            urlPattern: ({ request, url }) =>
              request.mode === "navigate" &&
              !url.pathname.startsWith("/api") &&
              !url.pathname.startsWith("/assets"),
            handler: "NetworkOnly",
            options: {
              precacheFallback: { fallbackURL: "/offline.html" },
            },
          },
          {
            // Hashed JS/CSS must never be served from the SW. Safari treats a
            // SW-handled module request as a CORS module load and can fail
            // with "Importing a module script failed".
            urlPattern: ({ url }) =>
              url.pathname.startsWith("/assets/") &&
              /\.(?:m?js|css)$/.test(url.pathname),
            handler: "NetworkOnly",
          },
          {
            urlPattern: /^https?:\/\/.*\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "images-cache",
              expiration: {
                maxEntries: 60,
                maxAgeSeconds: 30 * 24 * 60 * 60,
              },
            },
          },
        ],
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        clientsClaim: true,
        // No skipWaiting: the new worker waits for the Reload prompt.
        skipWaiting: false,
      },
    }),
    ...replitDevPlugins,
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
  optimizeDeps: {
    include: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/postprocessing",
      "postprocessing",
    ],
    esbuildOptions: {
      target: "esnext",
    },
  },
  ssr: {
    noExternal: [
      "three",
      "@react-three/fiber",
      "@react-three/drei",
      "@react-three/postprocessing",
      "postprocessing",
    ],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // Named vendor chunks for the heavy, view-specific libraries (Vite 8 /
        // Rolldown's replacement for Rollup's manualChunks). jspdf and
        // html2canvas already split on their own and are used independently,
        // so they are left alone. Each group is only
        // reachable through a lazy route or component, so none of them is in
        // the initial or Chat download; naming them keeps their hashes stable
        // across app deploys (better HTTP/SW cache hits) and stops them being
        // folded into whichever page happened to import them first.
        // Do not add packages that are imported statically by the app shell or
        // Chat (react, router, framer-motion, radix, lucide, dompurify, ...):
        // a group pulls everything in it into every importer's static graph.
        codeSplitting: {
          // Capture only the matched packages, not their dependencies (the
          // default would drag react/react-dom into vendor-three via R3F and
          // make every page import it).
          includeDependenciesRecursively: false,
          groups: [
            {
              name: "vendor-three",
              test: /[\\/]node_modules[\\/](three|@react-three|postprocessing|three-stdlib|three-mesh-bvh|troika-[^\\/]+|maath|camera-controls|meshline|stats-gl|@monogrid|n8ao)[\\/]/,
            },
            {
              // R3F's own runtime deps. Left ungrouped, Rolldown folded them into
              // a shared chunk with VesselAura.tsx, which imports three: that made
              // vendor-three ⇄ VesselAura a chunk cycle, so loading /cyberworld
              // first ran `new THREE.Matrix4()` before three was initialised
              // ("undefined is not a constructor (evaluating 'new a')").
              // Its own group has no three import, so no cycle (see
              // scripts/assertNoChunkCycles.mjs, run after every build).
              name: "vendor-r3f-runtime",
              test: /[\\/]node_modules[\\/](zustand|suspend-react|its-fine|react-use-measure)[\\/]/,
            },
            {
              // Babel helpers shared by drei and app code; kept apart so neither
              // the app shell nor vendor-three has to import the other's chunk.
              name: "vendor-babel-helpers",
              test: /[\\/]node_modules[\\/]@babel[\\/]runtime[\\/]/,
            },
            {
              name: "vendor-graph",
              test: /[\\/]node_modules[\\/](cytoscape|react-cytoscapejs)[\\/]/,
            },
            {
              name: "vendor-map",
              test: /[\\/]node_modules[\\/](leaflet|react-leaflet|@react-leaflet)[\\/]/,
            },
            {
              // recharts' runtime deps; ungrouped they were folded into the
              // Insights page chunk, making vendor-charts ⇄ Insights a cycle.
              name: "vendor-charts-runtime",
              test: /[\\/]node_modules[\\/](es-toolkit|redux-thunk|react-redux|eventemitter3|tiny-invariant|react-is|use-sync-external-store)[\\/]/,
            },
            {
              name: "vendor-charts",
              test: /[\\/]node_modules[\\/](recharts|victory-vendor|d3-[^\\/]+|internmap|decimal\.js-light|@reduxjs|redux|reselect|immer)[\\/]/,
            },
          ],
        },
      },
    },
  },
  server: {
    port: finalPort,

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
    port: finalPort,

    host: "0.0.0.0",
    allowedHosts: true,
  },
});
