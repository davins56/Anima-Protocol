// @ts-check
// Color scheme preference management.
// The product chrome is dark by default. OS light preference must not paint
// a white first screen — only an explicit stored choice (Settings) opts in.

export const initializeColorScheme = () => {
  const stored = localStorage.getItem("app-color-scheme");
  const theme = stored === "light" ? "light" : "dark";
  applyTheme(theme);

  return {
    getTheme: () =>
      localStorage.getItem("app-color-scheme") === "light" ? "light" : "dark",
    setTheme: (/** @type {string} */ newTheme) => {
      localStorage.setItem("app-color-scheme", newTheme);
      applyTheme(newTheme);
    },
  };
};

/**
 * @param {string} theme
 */
export const applyTheme = (theme) => {
  const html = document.documentElement;
  if (theme === "light") {
    html.classList.add("light");
    html.classList.remove("dark");
  } else {
    html.classList.remove("light");
    html.classList.add("dark");
  }
};
