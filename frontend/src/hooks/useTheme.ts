import { useState, useEffect, useCallback } from 'react';
import { STORAGE_KEYS } from '@/api';

type Theme = 'light' | 'dark' | 'system';

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

// Colors must match index.css @theme tokens and DESIGN.md
const THEME_COLORS = { light: '#faf9f6', dark: '#1c1917' } as const;

function applyTheme(theme: Theme) {
  const resolved = theme === 'system' ? getSystemTheme() : theme;
  document.documentElement.setAttribute('data-theme', resolved);

  // Sync the theme-color meta tag for browser chrome / PWA status bar.
  // When theme is 'system', the HTML media queries already handle it correctly,
  // so restore the original per-scheme colors. When the user explicitly picks a
  // theme, override both tags to force that color.
  if (theme === 'system') {
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      const media = meta.getAttribute('media');
      if (media?.includes('light')) meta.setAttribute('content', THEME_COLORS.light);
      else if (media?.includes('dark')) meta.setAttribute('content', THEME_COLORS.dark);
    });
  } else {
    const color = THEME_COLORS[resolved];
    document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
      meta.setAttribute('content', color);
    });
  }
}

export default function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.THEME);
    return (stored === 'light' || stored === 'dark' || stored === 'system') ? stored : 'system';
  });

  const setTheme = useCallback((newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem(STORAGE_KEYS.THEME, newTheme);
    applyTheme(newTheme);
  }, []);

  const toggle = useCallback(() => {
    const resolved = theme === 'system' ? getSystemTheme() : theme;
    setTheme(resolved === 'light' ? 'dark' : 'light');
  }, [theme, setTheme]);

  // Apply theme on mount and listen for system preference changes
  useEffect(() => {
    applyTheme(theme);

    if (theme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [theme]);

  const resolved = theme === 'system' ? getSystemTheme() : theme;

  return { theme, resolved, setTheme, toggle };
}
