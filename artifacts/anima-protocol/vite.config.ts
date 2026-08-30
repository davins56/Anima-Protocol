import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
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
  },
  plugins: [
    react({ jsxRuntime: "automatic" }),
    tailwindcss({ optimize: false }),
    // Replit-only: Clerk load failures are handled in-app (guest landing fallback).
    ...(runtimeErrorOverlay ? [runtimeErrorOverlay()] : []),
    // Auto-updating service worker. Once installed, every new deploy is picked
    // up automatically: the regenerated precache manifest triggers a SW update,
    // which skips waiting, claims open clients, and reloads them onto the fresh
    // build — so installed/home-screen users no longer need to remove and
    // re-add the app to see changes. Kept deliberately minimal: precache the
    // built assets only (`navigateFallback: null`), so it never intercepts
    // /api calls, /assets/* hashes, or the prerendered route HTML. Disabled in
    // dev to avoid interfering with HMR. The existing public/manifest.json is
    // reused (manifest: false), and registration happens in src/main.jsx.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: false,
      manifest: false,
      workbox: {
        importScripts: ["/push-notifications-sw.js"],
        globDirectory: path.resolve(import.meta.dirname, "dist/public"),
        globPatterns: [
          "**/*.{js,css,svg,png,ico,webp,woff,woff2,jpg,jpeg,json}",
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
        skipWaiting: true,
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
