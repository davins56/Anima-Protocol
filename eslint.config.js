import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  { ignores: ["**/dist/", "**/build/", "**/node_modules/", "**/*.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      // Relax rules for the existing codebase — tighten over time.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-unused-expressions": "warn",
      "no-unused-vars": "off",
      "no-misleading-character-class": "warn",
      "no-useless-escape": "warn",
      "no-useless-assignment": "warn",
      "no-empty": "warn",
      "no-redeclare": "warn",
      "prefer-const": "warn",
    },
  },
);
