// @ts-check
// Color scheme preference management.
// The product chrome is dark by default. OS light preference must not paint
// a white first screen — only an explicit stored choice (Settings) opts in.

/** Canvas hex values matching `:root` / `:root.light` `--background`. */
export const THEME_CANVAS_HEX = Object.freeze({
  dark: "#080A0C",
  light: "#F2F4F7",
});

export const getStoredColorScheme = () =>
  localStorage.getItem("app-color-scheme") === "light" ? "light" : "dark";

/**
 * Updates `color-scheme` and the browser chrome `theme-color` to match the
 * active light/dark surfaces. Does not write localStorage.
 * @param {"light" | "dark"} [mode]
 */
export const syncDocumentChrome = (mode) => {
  if (typeof document === "undefined") return;
  const html = document.documentElement;
  const resolved = mode === "light" || mode === "dark"
    ? mode
    : html.classList.contains("light") ? "light" : "dark";
  html.style.colorScheme = resolved;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  const raw = typeof getComputedStyle === "function"
    ? getComputedStyle(html).getPropertyValue("--background").trim()
    : "";
  meta.setAttribute("content", raw ? `hsl(${raw})` : THEME_CANVAS_HEX[resolved]);
};

export const initializeColorScheme = () => {
  const theme = getStoredColorScheme();
  applyTheme(theme);

  return {
    getTheme: getStoredColorScheme,
    setTheme: (/** @type {string} */ newTheme) => {
      if (newTheme !== "light" && newTheme !== "dark") return;
      localStorage.setItem("app-color-scheme", newTheme);
      applyTheme(newTheme);
    },
  };
};

/**
 * Apply light/dark classes for the Original Studio preset.
 * Preview-safe: does not write localStorage. No-ops when a non-Original
 * Appearance Studio preset is active, so those palettes stay in charge.
 * @param {string} theme
 */
export const applyTheme = (theme) => {
  const html = document.documentElement;
  const appearanceTheme = html.dataset.appearanceTheme;
  if (appearanceTheme && appearanceTheme !== "original") return;
  const resolved = theme === "light" ? "light" : "dark";
  if (resolved === "light") {
    html.classList.add("light");
    html.classList.remove("dark");
  } else {
    html.classList.remove("light");
    html.classList.add("dark");
  }
  syncDocumentChrome(resolved);
};

// The profile is authoritative for Original; other Studio presets remain device-specific.
export const syncProfileColorScheme = (theme) => {
  if (theme !== "light" && theme !== "dark") return;
  localStorage.setItem("app-color-scheme", theme);
  applyTheme(theme);
};
