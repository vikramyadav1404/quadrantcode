/**
 * What changed between two versions of a solution, described structurally.
 *
 * ## This is string analysis. It is not AI, and it is not a parser.
 *
 * The ticket calls it "AST-lite", and the emphasis belongs on *lite*. Parsing
 * four languages properly means four grammars or four dependencies, and every
 * one of them would be carried for a feature that only needs to answer "did the
 * changed line touch a comparison, a bound, or a container?".
 *
 * So it classifies tokens with patterns, and **says so when it cannot tell**:
 * a change it does not recognise comes back as `other` rather than being forced
 * into a category. F3.5 will weigh these, and a confident wrong label is worse
 * to it than an honest `other`.
 *
 * ## Determinism is the criterion, and it starts below this file
 *
 * `diffLines` is already proved deterministic — identical operations across
 * repeated runs, with its one traversal tie fixed. Everything here is a pure
 * function of those operations, in their order, with no set or map iteration
 * that could reorder between runs.
 *
 * ## Why `boundary` is its own category
 *
 * `<` becoming `<=`, a `+1` appearing, `0` becoming `length` — these are the
 * off-by-one family, and they are the single most common thing a binary search
 * gets wrong. F3.5's "recurring mistakes" panel names that pattern directly, so
 * the summariser has to be able to see it rather than reporting "a line
 * changed".
 */
import type { ExecutionLanguage } from '@/lib/execution/languages';
import { type DiffOp, diffLines, splitLines } from './diff';

export type ChangeKind = 'conditional' | 'boundary' | 'data_structure' | 'other';

export type LineChange = {
  kind: ChangeKind;
  /** The line as it was, when there was one. */
  before: string | null;
  /** The line as it became, when there is one. */
  after: string | null;
  /**
   * Why this kind was chosen, in words a person can check.
   *
   * Present for every classified change, because a category with no evidence is
   * a label the user has no way to disagree with — the same rule F3.3's
   * inferred stuck points follow (C4).
   */
  evidence: string[];
};

export type DiffSummary = {
  linesAdded: number;
  linesRemoved: number;
  /** A removal and an addition at the same position: one line rewritten. */
  linesModified: number;
  changes: LineChange[];
};

/**
 * Tokens that make a line a decision.
 *
 * Word-boundary anchored so `iffy` is not an `if`, and `andy` is not an `and`.
 */
const CONDITIONAL_PATTERNS: { pattern: RegExp; evidence: string }[] = [
  { pattern: /\bif\b/, evidence: 'an `if`' },
  { pattern: /\belse\b/, evidence: 'an `else`' },
  { pattern: /\bwhile\b/, evidence: 'a `while`' },
  { pattern: /&&|\|\||\band\b|\bor\b/, evidence: 'a boolean operator' },
  { pattern: /[!=]==?|\bnot\b/, evidence: 'an equality check' },
];

/**
 * Tokens that decide where a range stops.
 *
 * Order matters for evidence quality, not for correctness: the more specific
 * patterns are listed first so the sentence names the sharpest thing it found.
 */
const BOUNDARY_PATTERNS: { pattern: RegExp; evidence: string }[] = [
  { pattern: /<=|>=/, evidence: 'an inclusive comparison' },
  { pattern: /[^<>=!]<[^<=]|[^<>=!]>[^>=]/, evidence: 'a strict comparison' },
  { pattern: /[+-]\s*1\b/, evidence: 'an off-by-one adjustment' },
  { pattern: /\.length\b|\.size\(\)|\blen\(/, evidence: 'a length' },
  { pattern: /\[\s*0\s*\]|\b0\b/, evidence: 'a zero index or bound' },
  { pattern: /\bmid\b|\blo\b|\bhi\b|\bleft\b|\bright\b/, evidence: 'a search bound' },
];

/**
 * Containers, across the four languages this project runs.
 *
 * Names rather than types: `unordered_map` and `HashMap` and `dict` are the same
 * idea to a user reviewing their own mistake.
 */
const DATA_STRUCTURE_PATTERNS: { pattern: RegExp; evidence: string }[] = [
  { pattern: /\b(HashMap|unordered_map|defaultdict|Map|dict)\b/, evidence: 'a map' },
  { pattern: /\b(HashSet|unordered_set|Set|set)\b/, evidence: 'a set' },
  { pattern: /\b(vector|ArrayList|List|list|array|Array)\b/, evidence: 'a list' },
  { pattern: /\b(deque|queue|Queue|LinkedList)\b/, evidence: 'a queue' },
  { pattern: /\b(stack|Stack)\b/, evidence: 'a stack' },
  { pattern: /\b(heap|priority_queue|PriorityQueue|heapq)\b/, evidence: 'a heap' },
];

/**
 * Classify one changed line.
 *
 * Checked in order, and the first category that matches wins. Boundary before
 * conditional on purpose: `while (lo <= hi)` is a boundary change when the `<=`
 * moved, and calling it "a conditional changed" would bury the thing that
 * actually broke.
 */
function classify(text: string): { kind: ChangeKind; evidence: string[] } {
  const evidence: string[] = [];

  for (const { pattern, evidence: reason } of BOUNDARY_PATTERNS) {
    if (pattern.test(text)) evidence.push(reason);
  }
  if (evidence.length > 0) return { kind: 'boundary', evidence };

  for (const { pattern, evidence: reason } of DATA_STRUCTURE_PATTERNS) {
    if (pattern.test(text)) evidence.push(reason);
  }
  if (evidence.length > 0) return { kind: 'data_structure', evidence };

  for (const { pattern, evidence: reason } of CONDITIONAL_PATTERNS) {
    if (pattern.test(text)) evidence.push(reason);
  }
  if (evidence.length > 0) return { kind: 'conditional', evidence };

  /*
   * Nothing recognised. This is a real answer, not a fallback — a renamed
   * variable, a print statement, a comment. Forcing it into a category would
   * hand F3.5 a pattern that is not there.
   */
  return { kind: 'other', evidence: [] };
}

/**
 * Describe the change from one source to another.
 *
 * `language` is accepted and not yet used to vary the patterns: the token sets
 * above already span all four, and narrowing them per language would be a
 * behaviour change nothing has asked for. It is in the signature because the
 * caller always knows it and adding it later would touch every call site.
 */
export function summariseDiff(
  before: string,
  after: string,
  _language: ExecutionLanguage,
): DiffSummary {
  const ops = diffLines(before, after);
  const beforeLines = splitLines(before);

  const changes: LineChange[] = [];

  let linesAdded = 0;
  let linesRemoved = 0;
  let linesModified = 0;

  let beforeCursor = 0;

  for (const [index, step] of ops.entries()) {
    if (step.op === 'keep') {
      beforeCursor += step.count;
      continue;
    }

    if (step.op === 'remove') {
      const removed = beforeLines.slice(beforeCursor, beforeCursor + step.count);
      beforeCursor += step.count;

      /*
       * A removal immediately followed by an addition is a rewrite, not a
       * deletion plus an unrelated insertion. Pairing them is what lets the
       * summary say "`<` became `<=`" instead of "one line went, one arrived".
       */
      const next = ops[index + 1];
      const paired = next?.op === 'add' ? next.lines : [];

      for (const [offset, line] of removed.entries()) {
        const replacement = paired[offset] ?? null;

        if (replacement !== null) {
          linesModified += 1;
          // Both sides are classified together: the change is in the pair.
          changes.push({
            ...classify(`${line}\n${replacement}`),
            before: line,
            after: replacement,
          });
        } else {
          linesRemoved += 1;
          changes.push({ ...classify(line), before: line, after: null });
        }
      }
      continue;
    }

    // `add`. Any lines already paired with a preceding removal are accounted for.
    const previous = ops[index - 1];
    const alreadyPaired = previous?.op === 'remove' ? previous.count : 0;
    const fresh = step.lines.slice(alreadyPaired);

    for (const line of fresh) {
      linesAdded += 1;
      changes.push({ ...classify(line), before: null, after: line });
    }
  }

  return { linesAdded, linesRemoved, linesModified, changes };
}

/**
 * One sentence per change, for the timeline.
 *
 * Kept beside the analysis so the wording and the categories cannot drift
 * apart. Deliberately describes what changed and never why it was wrong —
 * "you fixed your off-by-one" is a claim about intent that nothing observed.
 */
export function describeChange(change: LineChange): string {
  const what =
    change.before === null
      ? 'Added a line'
      : change.after === null
        ? 'Removed a line'
        : 'Changed a line';

  if (change.evidence.length === 0) return what;

  return `${what} involving ${change.evidence.join(', ')}`;
}

/** True when nothing about the change could be classified. */
export function isUnclassified(summary: DiffSummary): boolean {
  return summary.changes.every((change) => change.kind === 'other');
}

export type { DiffOp };
