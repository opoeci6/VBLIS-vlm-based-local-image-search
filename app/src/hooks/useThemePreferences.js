import { useState, useEffect } from 'react';

export const useThemePreferences = () => {
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'dark';
  });

  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme]);

  const [uiTheme, setUiTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('ui_theme_style');
      if (saved) return saved;
    }
    return 'modern';
  });

  useEffect(() => {
    localStorage.setItem('ui_theme_style', uiTheme);
    if (uiTheme === 'terminal') {
      document.documentElement.setAttribute('data-theme-style', 'terminal');
    } else {
      document.documentElement.setAttribute('data-theme-style', 'modern');
    }
  }, [uiTheme]);

  return { theme, setTheme, uiTheme, setUiTheme };
};
