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
      localStorage.setItem('quadrantcode-theme', next);
    } catch {
      // Private mode or blocked storage — the toggle still works for this page.
    }
  }

  return (
    <button
      aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
      aria-pressed={theme === 'light'}
      className="auth-theme-toggle"
      onClick={toggle}
      type="button"
    >
      {theme === 'dark' ? (
        <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 16 16" width="15">
          <circle cx="8" cy="8" r="3" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M8 1v1.25M8 13.75V15M15 8h-1.25M2.25 8H1m11.95-4.95-.88.88m-8.14 8.14-.88.88m9.9 0-.88-.88M3.93 3.93l-.88-.88"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="1.5"
          />
        </svg>
      ) : (
        <svg aria-hidden="true" fill="none" height="15" viewBox="0 0 16 16" width="15">
          <path
            d="M13.5 10.2A6 6 0 0 1 5.8 2.5 5.75 5.75 0 1 0 13.5 10.2Z"
            stroke="currentColor"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
        </svg>
      )}
      <span>{theme === 'dark' ? 'Light' : 'Dark'}</span>
    </button>
  );
}
