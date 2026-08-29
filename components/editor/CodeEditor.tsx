'use client';

/**
 * The code editor.
 *
 * Monaco, loaded only on this route. `ssr: false` because it reaches for
 * `window` on import, and a dynamic import keeps ~1 MB out of every other
 * page's bundle — the editor is the one screen that can justify that size.
 *
 * The editor holds the user's own code and nothing else. Execution OUTPUT never
 * comes near it: output is rendered as React text nodes in the result panel,
 * which is what makes the "renders as inert text" criterion true by
 * construction rather than by sanitising something first.
 */
import dynamic from 'next/dynamic';
import { MONACO_LANGUAGE_IDS, type ExecutionLanguage } from '@/lib/execution/languages';

const Monaco = dynamic(() => import('@monaco-editor/react'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full min-h-[12rem] items-center justify-center text-sm text-[var(--text-muted)]">
      Loading the editor…
    </div>
  ),
});

export function CodeEditor({
  language,
  value,
  onChange,
}: {
  language: ExecutionLanguage;
  value: string;
  onChange: (next: string) => void;
}) {
  /*
   * `height="100%"`, over a wrapper whose height is DEFINITE at every width.
   *
   * Above `md` that is `h-full`: the split pane is `h-[calc(100vh-8rem)]`, so
   * the chain down to here has a real number and dragging the divider gives the
   * extra room to the code rather than to empty space.
   *
   * Below `md` the panes stack in a column with no definite height, and `h-full`
   * — `height: 100%` — resolves against `auto`. Monaco then measures its
   * container as five pixels and renders a sliver you cannot type in. A
   * `min-height` on the parent does NOT fix this: a percentage height resolves
   * against the parent's HEIGHT, and min-height is not it.
   *
   * So below `md` the wrapper carries the number itself.
   */
  return (
    <div className="h-[45vh] overflow-hidden md:h-full">
      <Monaco
        height="100%"
        language={MONACO_LANGUAGE_IDS[language]}
        onChange={(next) => onChange(next ?? '')}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          scrollBeyondLastLine: false,
          tabSize: 2,
          automaticLayout: true,
          // The submission cap is enforced server-side; wrapping just means a
          // long line is readable rather than scrolled off the right edge.
          wordWrap: 'on',
        }}
        theme="vs-dark"
        value={value}
      />
    </div>
  );
}
