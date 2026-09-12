'use client';

import Editor, { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// The wrapper defaults to a public CDN. Bundle Monaco locally so the editor
// works under the production CSP and does not send user traffic to a CDN.
loader.config({ monaco });

export default Editor;
