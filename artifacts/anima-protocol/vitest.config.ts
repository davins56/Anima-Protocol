import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
  },
  // Use the same JSX transform as the real app (vite.config.js) instead of a
  // manual `esbuild.jsx` option: this Vite/Vitest version transforms via oxc
  // by default and silently ignores esbuild-only options ("Both esbuild and
  // oxc options were set. oxc options will be used and esbuild options will
  // be ignored"), which broke JSX parsing in several *.test.jsx files. The
  // react() plugin handles the transform itself, so it's unaffected by which
  // engine Vite defaults to.
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
  },
});
