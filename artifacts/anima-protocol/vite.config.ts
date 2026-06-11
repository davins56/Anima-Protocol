import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { config as loadEnv } from "dotenv";

const repoRoot = path.resolve(import.meta.dirname, "../..");
loadEnv({ path: path.join(repoRoot, ".env") });
loadEnv({ path: path.join(import.meta.dirname, ".env"), override: true });

// Vite only exposes VITE_* to the client. On Vercel, CLERK_PUBLISHABLE_KEY is
// often set without the VITE_ prefix — mirror it so production builds embed the
// correct Clerk instance (avoids host-derived pk_live_ + missing GitHub SSO).
const clerkPublishableKey =
  process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() ||
  process.env.CLERK_PUBLISHABLE_KEY?.trim() ||
  "";

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


export default defineConfig({
  base: normalizedBasePath,

  ...(clerkPublishableKey
    ? {
        define: {
          "import.meta.env.VITE_CLERK_PUBLISHABLE_KEY":
            JSON.stringify(clerkPublishableKey),
        },
      }
    : {}),
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    // Replit-only: Clerk load failures are handled in-app (guest landing fallback).
    ...(process.env.REPL_ID !== undefined ? [runtimeErrorOverlay()] : []),
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
