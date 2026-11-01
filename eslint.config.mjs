// Repo-wide ESLint (flat config).
//
// `pnpm lint` used to be `echo 'No lint errors'`, so CI's Lint step could
// never fail. This config turns real linting on for the frontend and API.
// The frontend has never been linted, so every rule starts as a warning;
// only parse errors and broken hook calls fail the build. Promote rules to
// "error" one at a time as the warnings are cleaned up.

import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

/** Downgrade every rule in a config's `rules` block to "warn". */
function asWarnings(configs) {
  return configs.map((config) => {
    if (!config.rules) return config;
    const rules = {};
    for (const [name, value] of Object.entries(config.rules)) {
      const level = Array.isArray(value) ? value[0] : value;
      if (level === "off" || level === 0) {
        rules[name] = value;
      } else {
        rules[name] = Array.isArray(value) ? ["warn", ...value.slice(1)] : "warn";
      }
    }
    return { ...config, rules };
  });
}

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "**/coverage/**",
      "**/*.min.js",
      "**/playwright-report/**",
      "**/test-results/**",
      "deepseek-llm/**",
      "llm-chat-service/**",
      "anima-belonging/**",
      "server/**",
      "training/**",
      "ios/**",
      "artifacts/mockup-sandbox/**",
      "artifacts/anima-protocol/.agents/**",
      ".agents/**",
    ],
  },

  // Frontend (React, mostly .js/.jsx).
  ...asWarnings([
    {
      files: ["artifacts/anima-protocol/**/*.{js,jsx,mjs}"],
      ...js.configs.recommended,
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { ecmaFeatures: { jsx: true } },
      },
    },
  ]),

  // TypeScript across the workspace.
  ...asWarnings(
    tseslint.configs.recommended.map((config) => ({
      ...config,
      files: ["artifacts/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "scripts/**/*.ts"],
    })),
  ),
  {
    files: ["artifacts/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}", "scripts/**/*.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },

  // React hooks: calling a hook conditionally is a real bug, so it fails CI.
  {
    files: ["artifacts/anima-protocol/**/*.{js,jsx,ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },

  // Node scripts.
  {
    files: ["scripts/**/*.{js,mjs,cjs}", "*.{js,mjs,cjs}", "artifacts/*/scripts/**/*.{js,mjs}"],
    languageOptions: { globals: globals.node },
  },
);
