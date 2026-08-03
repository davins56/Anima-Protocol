// Color scheme preference management
export const initializeColorScheme = () => {
  // Check system preference
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;

  // Get stored preference
  const stored = localStorage.getItem('app-color-scheme');

  // Determine theme
  let theme = stored || (prefersLight ? 'light' : 'dark');

  // Apply theme
  applyTheme(theme);

  // Listen for system changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
    if (!localStorage.getItem('app-color-scheme')) {
      applyTheme(e.matches ? 'dark' : 'light');
    }
  });

  return {
    getTheme: () => localStorage.getItem('app-color-scheme') || (prefersDark ? 'dark' : 'light'),
    setTheme: (newTheme) => {
      localStorage.setItem('app-color-scheme', newTheme);
      applyTheme(newTheme);
    },
  };
};

export const applyTheme = (theme) => {
  const html = document.documentElement;
  if (theme === 'light') {
    html.classList.add('light');
    html.classList.remove('dark');
  } else {
    html.classList.remove('light');
    html.classList.add('dark');
  }
};