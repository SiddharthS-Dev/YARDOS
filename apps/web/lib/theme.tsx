'use client';

import { createContext, useCallback, useContext, useEffect, useState } from 'react';

/**
 * Theme.
 *
 * Light is the default: most of this console is read by finance officers, yard
 * managers and financiers on ordinary office screens. Dark exists because the
 * gate is different - a screen that runs a whole shift behind glass in a bright
 * yard is easier on the eyes dark, and that argument does not extend to an
 * invoice list.
 *
 * The preference is per-device and stored in localStorage. It is a display
 * preference, carries nothing sensitive, and should survive a browser restart
 * even though the session deliberately does not.
 */

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'yardos.theme';

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Starts light to match the server-rendered markup; the inline script in the
  // document head has already applied the stored choice to <html>, so there is
  // no flash. This effect only syncs React's copy of that state.
  const [theme, setThemeState] = useState<Theme>('light');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') {
      setThemeState(stored);
      return;
    }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (prefersDark) setThemeState('dark');
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A browser with site data blocked still gets a working theme for the
      // life of the tab; only persistence is lost.
    }
  }, []);

  const toggle = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggle }}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error('useTheme must be used inside ThemeProvider.');
  return context;
}

/**
 * Applies the stored theme before first paint.
 *
 * Injected into <head> as a blocking script. Without it the page renders light
 * and then snaps to dark once React hydrates, which is both ugly and, on a gate
 * screen at night, briefly blinding.
 */
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem('${STORAGE_KEY}');
    var theme = stored === 'light' || stored === 'dark'
      ? stored
      : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    document.documentElement.setAttribute('data-theme', theme);
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
`.trim();
