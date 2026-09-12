/**
 * Line diffs, and applying them back exactly.
 *
 * ## Why this is written here instead of installed
 *
 * The criterion is that `reconstruct()` rebuilds source **byte-identical**. The
 * obvious package, `diff`, produces unified-diff text — and `applyPatch` is
 * *deliberately* fuzzy: it searches nearby lines for context that no longer
 * matches, because it exists to apply human patches to drifted files. That
 * tolerance is the right behaviour for a patch tool and the wrong behaviour
 * here, where a near-miss silently returns code the user never wrote.
 *
 * These operations carry no context to match against, so there is nothing to
 * match fuzzily. `applyDiff` either walks the operations exactly or throws.
 *
 * ## Newlines are content, not separators
 *
 * `"a\nb"` and `"a\nb\n"` are different files and must round-trip differently.
 * Splitting on `\n` gives `['a','b']` for the first and `['a','b','']` for the
 * second — the trailing empty element IS the trailing newline, and joining
 * restores it. Nothing here trims, normalises CRLF, or adds a final newline;
 * a diff engine that tidies the input cannot rebuild the input.
 */

/**
 * One step of a diff.
 *
 * `keep` carries a COUNT rather than the lines themselves — that is where the
 * saving comes from, since unchanged lines are already in the previous version.
 * `add` carries its lines because they exist nowhere else.
 */
export type DiffOp =
  | { op: 'keep'; count: number }
  | { op: 'remove'; count: number }
  | { op: 'add'; lines: string[] };

export class DiffApplyError extends Error {
  readonly status = 500;

  constructor(message: string) {
    super(message);
    this.name = 'DiffApplyError';
  }
}

/**
 * The longest common subsequence of two line arrays, as a table of lengths.
 *
 * Classic dynamic programming: O(n·m) time and memory. Sources here are capped
 * at 64 KiB, so the worst realistic case is a few thousand lines against a few
 * thousand — millions of small integers, which is fine for a request path that
 * runs it once per snapshot.
 *
 * Guarding the size anyway, because "the cap protects us" is a statement about
 * a different file's constant.
 */
const MAX_DIFF_LINES = 20_000;

function lcsTable(before: string[], after: string[]): Uint32Array[] {
  const rows = before.length;
  const columns = after.length;

  const table: Uint32Array[] = Array.from(
    { length: rows + 1 },
    () => new Uint32Array(columns + 1),
  );

  for (let i = rows - 1; i >= 0; i -= 1) {
    for (let j = columns - 1; j >= 0; j -= 1) {
      table[i]![j] =
        before[i] === after[j]
          ? table[i + 1]![j + 1]! + 1
          : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }

  return table;
}

/**
 * Split a source into lines such that joining them restores it exactly.
 *
 * Exported so the tests can assert the round-trip property on its own, rather
 * than only through a diff that might be hiding a compensating bug.
 */
export function splitLines(source: string): string[] {
  return source.split('\n');
}

export function joinLines(lines: string[]): string {
  return lines.join('\n');
}

/**
 * Operations that turn `before` into `after`.
 *
 * Deterministic: the same pair always produces the same operations, because the
 * traversal below breaks every tie the same way (prefer `remove` before `add`).
 * The ticket asks for a summariser whose output is stable, and stability starts
 * here — a diff that varies between runs makes every downstream signal vary.
 */
export function diffLines(before: string, after: string): DiffOp[] {
  const source = splitLines(before);
  const target = splitLines(after);

  if (source.length > MAX_DIFF_LINES || target.length > MAX_DIFF_LINES) {
    // Fall back to storing the whole thing rather than spending seconds on a
    // table nobody asked for. The caller decides what to do with one `add`.
    return [
      { op: 'add', lines: target },
      { op: 'remove', count: source.length },
    ];
  }

  const table = lcsTable(source, target);
  const ops: DiffOp[] = [];

  let i = 0;
  let j = 0;

  /** Coalesce runs, so 40 unchanged lines are one op rather than forty. */
  const push = (next: DiffOp): void => {
    const last = ops.at(-1);

    if (last && last.op === 'keep' && next.op === 'keep') {
      last.count += next.count;
      return;
    }
    if (last && last.op === 'remove' && next.op === 'remove') {
      last.count += next.count;
      return;
    }
    if (last && last.op === 'add' && next.op === 'add') {
      last.lines.push(...next.lines);
      return;
    }

    ops.push(next);
  };

  while (i < source.length && j < target.length) {
    if (source[i] === target[j]) {
      push({ op: 'keep', count: 1 });
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) {
      // Tie goes to `remove`, always. This is the only tie in the traversal,
      // and fixing it is what makes the output deterministic.
      push({ op: 'remove', count: 1 });
      i += 1;
    } else {
      push({ op: 'add', lines: [target[j]!] });
      j += 1;
    }
  }

  while (i < source.length) {
    push({ op: 'remove', count: 1 });
    i += 1;
  }

  while (j < target.length) {
    push({ op: 'add', lines: [target[j]!] });
    j += 1;
  }

  return ops;
}

/**
 * Rebuild `after` from `before` and the operations.
 *
 * Throws rather than guessing. Every failure here means the stored chain is
 * broken, and returning "close enough" code would be worse than saying so: the
 * user would be shown something they never wrote, with no indication.
 */
export function applyDiff(before: string, ops: readonly DiffOp[]): string {
  const source = splitLines(before);
  const result: string[] = [];

  let cursor = 0;

  for (const step of ops) {
    if (step.op === 'keep') {
      if (cursor + step.count > source.length) {
        throw new DiffApplyError(
          `keep of ${step.count} runs past the end of a ${source.length}-line source`,
        );
      }
      result.push(...source.slice(cursor, cursor + step.count));
      cursor += step.count;
      continue;
    }

    if (step.op === 'remove') {
      if (cursor + step.count > source.length) {
        throw new DiffApplyError(
          `remove of ${step.count} runs past the end of a ${source.length}-line source`,
        );
      }
      cursor += step.count;
      continue;
    }

    result.push(...step.lines);
  }

  if (cursor !== source.length) {
    throw new DiffApplyError(
      `diff consumed ${cursor} of ${source.length} lines — the chain does not match`,
    );
  }

  return joinLines(result);
}

/** Serialised form, as stored in `code_snapshots.content`. */
export function encodeDiff(ops: readonly DiffOp[]): string {
  return JSON.stringify(ops);
}

export function decodeDiff(content: string): DiffOp[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(content);
  } catch (error) {
    throw new DiffApplyError(
      `stored diff is not valid JSON: ${error instanceof Error ? error.message : 'unknown'}`,
    );
  }

  if (!Array.isArray(parsed)) {
    throw new DiffApplyError('stored diff is not an array of operations');
  }

  return parsed as DiffOp[];
}
