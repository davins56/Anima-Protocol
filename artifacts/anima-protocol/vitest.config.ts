import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
  },
  // App components use the automatic JSX runtime (no `import React`), so the
  // test transform must too — otherwise rendering a page throws "React is not
  // defined".
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.{test,spec}.{js,jsx,ts,tsx}"],
  },
});
