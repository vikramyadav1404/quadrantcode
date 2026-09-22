/**
 * F4.1 · PEP 585 annotations on a Python 3.8 runtime.
 *
 * Judge0 runs Python 3.8.1 and nothing newer exists to move to. All 100 native
 * reference solutions annotate with `list[int]`, which 3.8 evaluates at import
 * time and rejects:
 *
 *   TypeError: 'type' object is not subscriptable
 *
 * `from __future__ import annotations` defuses it. The interesting part is not
 * adding the line — it is adding it without breaking source that already has a
 * future import of its own, since Python requires them before every statement
 * but a docstring.
 */
import { describe, expect, it } from 'vitest';
import { hoistPythonFutureImports, wrapUserSource } from '@/server/services/execution/native';

const WRAPPER =
  '/*__USER_CODE__*/\nif __name__ == "__main__":\n    import sys\n    print(solve([int(x) for x in sys.stdin.read().split()]))';

/**
 * Python's own rule, applied as an assertion.
 *
 * A future import is legal only before every statement. A string literal is the
 * module DOCSTRING — and therefore not a statement for this purpose — only when
 * nothing at all precedes it. That last clause is the whole subtlety: after a
 * future import, the same string is an ordinary expression statement, and a
 * second future import below it is a SyntaxError.
 */
function futureImportsAreLegal(source: string): boolean {
  let seenStatement = false;
  let docstringAllowed = true;
  let inDocstring = false;

  for (const raw of source.split('\n')) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith('#')) continue;

    if (inDocstring) {
      if (line.includes('"""') || line.includes("'''")) inDocstring = false;
      continue;
    }

    if (line.startsWith('from __future__ import')) {
      if (seenStatement) return false;
      // Anything after this can no longer be the docstring.
      docstringAllowed = false;
      continue;
    }

    if (docstringAllowed && (line.startsWith('"""') || line.startsWith("'''"))) {
      const fence = line.startsWith('"""') ? '"""' : "'''";
      const closes = line.length > 3 && line.endsWith(fence);
      if (!closes) inDocstring = true;
      docstringAllowed = false;
      continue;
    }

    seenStatement = true;
    docstringAllowed = false;
  }
  return true;
}

describe('F4.1 · hoistPythonFutureImports', () => {
  it('adds the annotations import to source that has none', () => {
    const out = hoistPythonFutureImports('def solve(v: list[int]) -> int:\n    return 0');
    expect(out.startsWith('from __future__ import annotations\n')).toBe(true);
    expect(out).toContain('def solve(v: list[int]) -> int:');
  });

  it('does not emit the import twice when the source already has it', () => {
    const out = hoistPythonFutureImports(
      'from __future__ import annotations\ndef solve(v: list[int]) -> int:\n    return 0',
    );
    expect(out.match(/from __future__ import/g)).toHaveLength(1);
    expect(out).toContain('annotations');
  });

  it('merges other future features instead of dropping them', () => {
    const out = hoistPythonFutureImports(
      'from __future__ import division\ndef solve(v: list[int]) -> int:\n    return 1',
    );
    expect(out.match(/from __future__ import/g)).toHaveLength(1);
    const first = out.split('\n')[0]!;
    expect(first).toContain('annotations');
    expect(first).toContain('division');
  });

  it('merges a multi-feature import', () => {
    const out = hoistPythonFutureImports(
      'from __future__ import division, print_function\nx = 1',
    );
    const first = out.split('\n')[0]!;
    for (const feature of ['annotations', 'division', 'print_function']) {
      expect(first).toContain(feature);
    }
    expect(out.match(/from __future__ import/g)).toHaveLength(1);
  });

  /**
   * THE case this function exists for. Prepending naively would leave the
   * user's future import after a string expression, which is a SyntaxError.
   */
  it('hoists a future import that sits AFTER a module docstring', () => {
    const source =
      '"""My solution."""\nfrom __future__ import division\ndef solve(v): return 1';
    const out = hoistPythonFutureImports(source);

    expect(out.split('\n')[0]).toMatch(/^from __future__ import /);
    expect(out.match(/from __future__ import/g)).toHaveLength(1);
    expect(futureImportsAreLegal(out)).toBe(true);

    // Positive control: the naive fix produces source Python rejects.
    const naive = `from __future__ import annotations\n${source}`;
    expect(futureImportsAreLegal(naive)).toBe(false);
  });

  it('hoists a future import that sits after ordinary statements', () => {
    const out = hoistPythonFutureImports('import sys\nfrom __future__ import division\nx = 1');
    expect(futureImportsAreLegal(out)).toBe(true);
    expect(out.match(/from __future__ import/g)).toHaveLength(1);
  });

  it('keeps line numbering stable by leaving a blank where the import was', () => {
    // A traceback that points at the wrong line is worse than no traceback.
    const source = 'import sys\nfrom __future__ import division\nraise SystemExit(1)';
    const out = hoistPythonFutureImports(source);
    // One line added at the top, none removed from the body.
    expect(out.split('\n')).toHaveLength(source.split('\n').length + 1);
  });
});

describe('F4.1 · wrapUserSource applies it only to Python', () => {
  const PY = 'def solve(v: list[int]) -> int:\n    return 0';

  it('hoists for python3', () => {
    const out = wrapUserSource(WRAPPER, PY, 'python3');
    expect(out.startsWith('from __future__ import annotations\n')).toBe(true);
    expect(out).toContain('if __name__ == "__main__":');
  });

  it.each(['c11', 'cpp17', 'java', 'javascript'] as const)(
    'leaves %s untouched',
    (language) => {
      const source = 'int main(){return 0;}';
      const out = wrapUserSource(WRAPPER, source, language);
      expect(out).not.toContain('__future__');
      expect(out).toBe(wrapUserSource(WRAPPER, source));
    },
  );

  it('still refuses a wrapper without exactly one marker', () => {
    expect(() => wrapUserSource('no marker here', PY, 'python3')).toThrow(/user-code marker/);
    expect(() => wrapUserSource('/*__USER_CODE__*//*__USER_CODE__*/', PY, 'python3')).toThrow(
      /user-code marker/,
    );
  });

  it('puts the import before the wrapper prologue, not just before user code', () => {
    // The marker is not always first in a template; the future import must
    // still lead the assembled file.
    const out = wrapUserSource('import sys\n/*__USER_CODE__*/\nprint(1)', PY, 'python3');
    expect(out.split('\n')[0]).toMatch(/^from __future__ import /);
    expect(futureImportsAreLegal(out)).toBe(true);
  });
});

describe('F4.1 · the real library shape', () => {
  it('fixes the exact solution that failed reference validation', () => {
    // archive-shelf-reward, verbatim.
    const real =
      'def solve(v: list[int]) -> int:\n    a=b=0\n    for x in v:a,b=b,max(b,a+x)\n    return b';
    const out = wrapUserSource(WRAPPER, real, 'python3');

    expect(out.split('\n')[0]).toBe('from __future__ import annotations');
    expect(out).toContain('def solve(v: list[int]) -> int:');
    expect(futureImportsAreLegal(out)).toBe(true);
  });
});
