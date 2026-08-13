'use client';

/**
 * Theme toggle. Writes `data-theme` on <html> and persists the choice; the
 * inline script in app/layout.tsx replays it before first paint, so there is
 * no flash of the wrong theme on reload.
 */
import { useEffect, useState } from 'react';

type Theme = 'dark' | 'light';

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    const stored = document.documentElement.getAttribute('data-theme');
    setTheme(stored === 'light' ? 'light' : 'dark');
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try {
      localStorage.setItem('traceloop-theme', next);
    } catch {
      // Private mode or blocked storage — the toggle still works for this page.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={theme === 'light'}
      className="rounded-[var(--radius)] border border-[var(--border)] px-2 py-1 text-xs"
    >
      {theme === 'dark' ? 'Light mode' : 'Dark mode'}
    </button>
  );
}
