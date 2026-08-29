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
   * `height="100%"` and a filling wrapper, not a fixed 420px.
   *
   * The editor now lives in a resizable pane; a fixed height means dragging the
   * divider gives the extra room to empty space instead of to the code.
   */
  return (
    <div className="h-full overflow-hidden">
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
