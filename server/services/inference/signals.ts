/**
 * Five deterministic signals over a session's telemetry.
 *
 * ## Nothing here calls anything. There is no model, no network, no clock.
 *
 * Every function takes the whole session as data and returns regions. That is
 * what makes the adversarial cases testable — a user who typed continuously, a
 * user who was idle throughout, a session with one keystroke — without needing
 * a database or a fake for anything.
 *
 * ## What these signals are NOT
 *
 * They are evidence that *something happened at a place and a time*. They are
 * not evidence about the user's state of mind. Somebody whose edits stayed in
 * one region for six minutes may have been stuck, or reading, or on the phone.
 * **C4**: every output is a hedge, every output is editable, and the wording is
 * enforced by a test that greps this module for the words that would overstate.
 *
 * ## Signal 1 is `edit_locality`, not `cursor dwell`
 *
 * The ticket names cursor dwell — the cursor staying within ±3 lines for over
 * two minutes. **There is no cursor telemetry in this project**: no event type,
 * nothing in the editor emitting one, and adding it would mean sampling a
 * position every few seconds for the whole session.
 *
 * So this measures where the EDITS were instead: consecutive snapshots landing
 * in the same narrow window over a long stretch, with no successful run. That
 * is a different measurement and it carries a different name, because calling
 * it cursor dwell would be a claim about something nothing watched. It is
 * arguably the better signal — a still cursor can mean the user is reading the
 * statement in another tab, while repeated edits in one place are effort.
 */
import { type InferenceInput, type InferenceSnapshot, type SignalHit } from './types';

/** How far apart two lines can be and still count as the same region. */
export const REGION_RADIUS = 3;

/**
 * The widest a locality region may be, in lines.
 *
 * **Found by the adversarial test**, which is what it was written for. Chaining
 * on consecutive PAIRS — is this snapshot near the last one? — lets a region
 * grow without limit: a user typing steadily down a file edits line 1, then 2,
 * then 3, and every pair is within the radius, so forty lines over twenty
 * minutes came back as one "region". A region that covers the whole program is
 * not a finding, it is a restatement of the session.
 *
 * The window is checked against the region AS A WHOLE now, which is what the
 * ticket's "±3 line window" meant.
 */
export const REGION_MAX_SPAN = REGION_RADIUS * 2 + 1;

/** A locality region must span at least this long to be worth showing. */
export const DWELL_MIN_SECONDS = 120;

/** How many times a range must be revisited before it counts as churn. */
export const CHURN_MIN_EDITS = 3;

/** How many failures in a row make a cluster. */
export const CLUSTER_MIN_FAILURES = 2;

/** A gap at least this long, right after a failure, is an idle period. */
export const IDLE_MIN_SECONDS = 90;

/** Two line sets overlap when any pair is within the radius. */
function near(a: readonly number[], b: readonly number[]): boolean {
  return a.some((left) => b.some((right) => Math.abs(left - right) <= REGION_RADIUS));
}

/** Would adding these lines make the region wider than a region should be? */
function fitsWindow(existing: readonly number[], next: readonly number[]): boolean {
  const all = [...existing, ...next];
  return Math.max(...all) - Math.min(...all) < REGION_MAX_SPAN;
}

/**
 * Did a run pass between these two moments?
 *
 * Shared by locality and churn. This whole module is about struggle, and a
 * passing run inside the window is direct evidence of the opposite — somebody
 * iterating successfully in one function is working, not stuck. Without this,
 * three edits around a green run counted as churn.
 */
function passedWithin(input: InferenceInput, from: number, to: number): boolean {
  return input.runs.some(
    (attempt) =>
      attempt.passed && attempt.elapsedSeconds >= from && attempt.elapsedSeconds <= to,
  );
}

function span(lines: readonly number[]): { lineStart: number; lineEnd: number } {
  return { lineStart: Math.min(...lines), lineEnd: Math.max(...lines) };
}

/** Whole seconds, formatted the way the evidence sentences read. */
function duration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return rest === 0 ? `${minutes}m` : `${minutes}m${String(rest).padStart(2, '0')}s`;
}

/**
 * SIGNAL 1 · edit locality.
 *
 * Consecutive snapshots whose changed lines stay within a narrow window, over a
 * stretch longer than two minutes, with no run passing inside it — **and where
 * at least one line was edited more than once.**
 *
 * ## The revisit condition, and why the adversarial test forced it
 *
 * Without it, somebody typing steadily down a file is reported as stuck. Each
 * consecutive pair of edits is within the radius, no run has passed because
 * they have not run anything yet, and two minutes go by — so the signal fires
 * on a person calmly writing a solution.
 *
 * What actually separates dwell from progress is that the edits **stopped
 * moving**. A user making their way down a file never comes back; a user stuck
 * on line 12 edits 12, then 13, then 12 again. Requiring a repeated line is the
 * honest definition of "dwelling", and it is what the ticket's cursor-based
 * version got for free — a cursor that has not moved is trivially revisiting.
 *
 * This does NOT collapse into churn. Churn is a count with no clock: three
 * rewrites in twenty seconds. Dwell is a clock with one repeat: two edits to
 * the same line five minutes apart.
 */
export function editLocality(input: InferenceInput): SignalHit[] {
  const hits: SignalHit[] = [];
  const withEdits = input.snapshots.filter((snapshot) => snapshot.touchedLines.length > 0);

  let run: InferenceSnapshot[] = [];

  const flush = () => {
    if (run.length < 2) {
      run = [];
      return;
    }

    const from = run[0]!.elapsedSeconds;
    const to = run.at(-1)!.elapsedSeconds;
    const seconds = to - from;

    if (seconds < DWELL_MIN_SECONDS) {
      run = [];
      return;
    }

    // A pass inside the window means this was progress, not a wall.
    if (passedWithin(input, from, to)) {
      run = [];
      return;
    }

    const lines = run.flatMap((snapshot) => snapshot.touchedLines);

    // Edits that never return to a line are progress down a file, not dwelling.
    const revisited = lines.some((line, index) => lines.indexOf(line) !== index);
    if (!revisited) {
      run = [];
      return;
    }

    const { lineStart, lineEnd } = span(lines);

    hits.push({
      signal: 'edit_locality',
      lineStart,
      lineEnd,
      startedSeconds: from,
      endedSeconds: to,
      durationSeconds: seconds,
      confidence: seconds >= DWELL_MIN_SECONDS * 2 ? 'high' : 'medium',
      evidence: [
        `edits stayed around lines ${lineStart}–${lineEnd} for ${duration(seconds)}`,
        'no run passed during that stretch',
      ],
    });

    run = [];
  };

  for (const snapshot of withEdits) {
    const chained = run.flatMap((entry) => entry.touchedLines);

    if (
      run.length === 0 ||
      (near(run.at(-1)!.touchedLines, snapshot.touchedLines) &&
        fitsWindow(chained, snapshot.touchedLines))
    ) {
      run.push(snapshot);
      continue;
    }
    flush();
    run = [snapshot];
  }
  flush();

  return hits;
}

/**
 * SIGNAL 2 · edit churn.
 *
 * The same line range modified three or more times across snapshots. Unlike
 * locality this is a COUNT, not a duration: three rewrites of one line in
 * thirty seconds is churn without dwell, and both are worth seeing.
 *
 * ## "Modified three times" means repetition, not coverage
 *
 * The first version counted SNAPSHOTS that landed in a bucket, which made seven
 * consecutive lines touched once each look identical to one line rewritten
 * seven times. The adversarial case caught it: a user typing down a file was
 * reported as churning through every window of the file they crossed.
 *
 * So a bucket is churn only when its edits OUTNUMBER its distinct lines. Seven
 * edits across seven lines is writing; three edits across two lines means
 * something was written more than once.
 */
export function editChurn(input: InferenceInput): SignalHit[] {
  const withEdits = input.snapshots.filter((snapshot) => snapshot.touchedLines.length > 0);
  const buckets: { lines: number[]; times: number[] }[] = [];

  for (const snapshot of withEdits) {
    const bucket = buckets.find(
      (candidate) =>
        near(candidate.lines, snapshot.touchedLines) &&
        fitsWindow(candidate.lines, snapshot.touchedLines),
    );

    if (bucket) {
      bucket.lines.push(...snapshot.touchedLines);
      bucket.times.push(snapshot.elapsedSeconds);
    } else {
      buckets.push({ lines: [...snapshot.touchedLines], times: [snapshot.elapsedSeconds] });
    }
  }

  return buckets
    .filter((bucket) => bucket.times.length >= CHURN_MIN_EDITS)
    .filter((bucket) => bucket.times.length > new Set(bucket.lines).size)
    .filter(
      // Same rule as locality: edits around a passing run are iteration, not
      // churn. The adversarial "long successful session" case is what surfaced
      // this — three edits with two green runs between them came back as a
      // stuck region.
      (bucket) => !passedWithin(input, Math.min(...bucket.times), Math.max(...bucket.times)),
    )
    .map((bucket) => {
      const { lineStart, lineEnd } = span(bucket.lines);
      const from = Math.min(...bucket.times);
      const to = Math.max(...bucket.times);

      return {
        signal: 'edit_churn' as const,
        lineStart,
        lineEnd,
        startedSeconds: from,
        endedSeconds: to,
        durationSeconds: to - from,
        confidence: bucket.times.length >= CHURN_MIN_EDITS + 2 ? 'high' : 'medium',
        evidence: [`lines ${lineStart}–${lineEnd} were changed ${bucket.times.length} times`],
      };
    });
}

/**
 * SIGNAL 3 · run-failure clustering.
 *
 * Two or more consecutive failed runs whose surrounding edits land in the same
 * region. The edits are what give it a place: a failure on its own says the
 * program was wrong, not where the user was working.
 */
export function failureCluster(input: InferenceInput): SignalHit[] {
  const hits: SignalHit[] = [];
  let streak: number[] = [];

  const flush = () => {
    if (streak.length < CLUSTER_MIN_FAILURES) {
      streak = [];
      return;
    }

    const from = streak[0]!;
    const to = streak.at(-1)!;

    /*
     * The edits made between the first and last failure of the streak. Without
     * any, there is no region to point at — the user changed nothing and ran
     * the same code twice, which is a different story and not this signal's.
     */
    const lines = input.snapshots
      .filter((snapshot) => snapshot.elapsedSeconds >= from && snapshot.elapsedSeconds <= to)
      .flatMap((snapshot) => snapshot.touchedLines);

    if (lines.length > 0) {
      const { lineStart, lineEnd } = span(lines);

      hits.push({
        signal: 'failure_cluster',
        lineStart,
        lineEnd,
        startedSeconds: from,
        endedSeconds: to,
        durationSeconds: to - from,
        confidence: streak.length >= CLUSTER_MIN_FAILURES + 1 ? 'high' : 'medium',
        evidence: [
          `${streak.length} runs failed in a row`,
          `the edits between them touched lines ${lineStart}–${lineEnd}`,
        ],
      });
    }

    streak = [];
  };

  for (const attempt of [...input.runs].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds)) {
    if (attempt.passed) {
      flush();
      continue;
    }
    streak.push(attempt.elapsedSeconds);
  }
  flush();

  return hits;
}

/**
 * SIGNAL 4 · idle after a failure.
 *
 * A long gap in activity immediately following a failed run.
 *
 * The gap is DERIVED from the spacing of events rather than read from
 * `idle_started` / `idle_ended`. Those types exist in F3.2's taxonomy and
 * nothing emits them; the gap between two consecutive events is the same fact
 * and needs no new write path — the same argument D25 made for elapsed.
 *
 * Confidence is deliberately capped at `low`. Silence after a failure is the
 * weakest thing in this file: it is equally consistent with thinking hard, and
 * with closing the laptop.
 */
export function idleAfterFailure(input: InferenceInput): SignalHit[] {
  const ordered = [...input.events].sort((a, b) => a.elapsedSeconds - b.elapsedSeconds);
  const hits: SignalHit[] = [];

  for (const attempt of input.runs) {
    if (attempt.passed) continue;

    const next = ordered.find((event) => event.elapsedSeconds > attempt.elapsedSeconds);
    const resumesAt = next?.elapsedSeconds ?? input.totalSeconds;
    const gap = resumesAt - attempt.elapsedSeconds;

    if (gap < IDLE_MIN_SECONDS) continue;

    /*
     * The region is wherever the user was last editing. Without a snapshot
     * before the failure there is nothing to point at, and a region covering
     * the whole file would be a guess dressed as a finding.
     */
    const previous = [...input.snapshots]
      .filter(
        (snapshot) =>
          snapshot.elapsedSeconds <= attempt.elapsedSeconds && snapshot.touchedLines.length > 0,
      )
      .at(-1);

    if (!previous) continue;

    const { lineStart, lineEnd } = span(previous.touchedLines);

    hits.push({
      signal: 'idle_after_failure',
      lineStart,
      lineEnd,
      startedSeconds: attempt.elapsedSeconds,
      endedSeconds: resumesAt,
      durationSeconds: gap,
      confidence: 'low',
      evidence: [
        `a run failed, then nothing happened for ${duration(gap)}`,
        `the last edit before it touched lines ${lineStart}–${lineEnd}`,
      ],
    });
  }

  return hits;
}

/**
 * SIGNAL 5 · the user said so.
 *
 * Not an inference at all, which is why it carries `user_marked` and always
 * ranks first. It has no line range: F1.5 records a marker without asking
 * where, and inventing one here would put words in the user's mouth.
 */
export function userMarkers(input: InferenceInput): SignalHit[] {
  return input.markers.map((marker) => ({
    signal: 'user_marker' as const,
    // A zero range is the encoding for "no range", checked by the persistence
    // layer before it writes — the column pair is nullable for exactly this.
    lineStart: 0,
    lineEnd: 0,
    startedSeconds: marker.elapsedSeconds,
    endedSeconds: marker.elapsedSeconds,
    durationSeconds: 0,
    confidence: 'user_marked' as const,
    evidence: [`you marked yourself stuck at ${duration(marker.elapsedSeconds)}`],
  }));
}

/** Every signal, in one call. Order here does not matter; ranking sorts them. */
export function runSignals(input: InferenceInput): SignalHit[] {
  return [
    ...userMarkers(input),
    ...editLocality(input),
    ...editChurn(input),
    ...failureCluster(input),
    ...idleAfterFailure(input),
  ];
}
