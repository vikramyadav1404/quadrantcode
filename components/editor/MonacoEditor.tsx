'use client';

import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

/*
 * Monaco's own worker loader wraps the worker URL in a blob: module and
 * `import()`s it from there. The bundler emits that URL root-relative
 * (/_next/static/...), and a blob: module has no base to resolve it against,
 * so the editor worker never loaded: "Failed to resolve module specifier" on
 * every solve page (Sentry QUADRANTCODE-7/8), with Monaco falling back to the
 * main thread. Creating the workers here, with a `new Worker(new URL(...))` the
 * bundler sees, loads them from a real same-origin URL that `worker-src 'self'`
 * already allows.
 *
 * Once `getWorker` is defined Monaco routes EVERY worker through it, the
 * JavaScript language service included, so that label must get its own worker.
 */
globalThis.MonacoEnvironment = {
  getWorker(_workerId: string, label: string) {
    if (label === 'typescript' || label === 'javascript') {
      return new Worker(
        new URL('monaco-editor/language/typescript/ts.worker.js', import.meta.url),
        {
          type: 'module',
        },
      );
    }
    return new Worker(new URL('monaco-editor/editor/editor.worker.js', import.meta.url), {
      type: 'module',
    });
  },
};

// The wrapper defaults to a public CDN. Bundle Monaco locally so the editor
// works under the production CSP and does not send user traffic to a CDN.
loader.config({ monaco });

export default Editor;
