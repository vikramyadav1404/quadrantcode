'use client';

/**
 * The theme currently set on <html>, kept in sync when it changes.
 *
 * ## Why this reads the DOM instead of a context
 *
 * There is no theme provider. `ThemeToggle` writes `data-theme` on the document
 * element and the inline script in `app/layout.tsx` replays the stored value
 * before first paint — which is what makes `e2e/theme.spec.ts`'s "no flash of
 * the wrong theme" assertion true. CSS reads that attribute directly, so
 * nothing in React ever needed to know the value.
 *
 * Monaco does. It takes a theme *name* rather than CSS custom properties, so it
 * cannot inherit the tokens the way every other component does; without this it
 * keeps whatever it mounted with and a light-theme user gets a dark editor.
 *
 * ## The initial value is deliberately not read during render
 *
 * It starts at 'dark' — the token default and what the server renders — then
 * corrects in an effect. Reading `document` during render would produce a
 * different tree on the server and on hydration.
 */
import { useEffect, useState } from 'react';

export type ThemeName = 'dark' | 'light';

export function useThemeName(): ThemeName {
  const [theme, setTheme] = useState<ThemeName>('dark');

  useEffect(() => {
    const read = () => {
      const attribute = document.documentElement.getAttribute('data-theme');
      setTheme(attribute === 'light' ? 'light' : 'dark');
    };

    read();

    // The toggle sets the attribute imperatively and nothing re-renders this
    // tree, so an observer is the only way to hear about it.
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme'],
    });

    return () => observer.disconnect();
  }, []);

  return theme;
}
