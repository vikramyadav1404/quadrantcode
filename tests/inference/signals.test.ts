/**
 * F3.3 · the five signals, over synthetic event streams.
 *
 * The ticket asks for each signal in isolation, then in combination, then in
 * adversarial cases. All three are here, and the adversarial ones matter most:
 * a heuristic that fires on a user who typed steadily for an hour is a
 * heuristic that tells everyone they were stuck, which is the same as telling
 * them nothing.
 *
 * Everything is pure. No database, no clock, no fake — the signals take a
 * session as data and return regions, which is what makes "a session with one
 * keystroke" a two-line test rather than a fixture.
 */
import { describe, expect, it } from 'vitest';
import {
  CHURN_MIN_EDITS,
  CLUSTER_MIN_FAILURES,
  DWELL_MIN_SECONDS,
  IDLE_MIN_SECONDS,
  editChurn,
  editLocality,
  failureCluster,
  idleAfterFailure,
  runSignals,
  userMarkers,
} from '@/server/services/inference/signals';
import { rankRegions } from '@/server/services/inference/rank';
import type { InferenceInput } from '@/server/services/inference/types';

const SOURCE = Array.from({ length: 40 }, (_, n) => `line ${n + 1}`).join('\n');

function input(overrides: Partial<InferenceInput> = {}): InferenceInput {
  return {
    events: [],
    snapshots: [],
    runs: [],
    markers: [],
    totalSeconds: 3600,
    ...overrides,
  };
}

/** A snapshot that changed `lines` at `at` seconds. */
function snap(at: number, lines: number[], sequence = at) {
  return { sequence, elapsedSeconds: at, touchedLines: lines, source: SOURCE };
}

describe('F3.3 · signal 1 · edit locality', () => {
  it('FIRES when edits keep returning to one window for over two minutes', () => {
    // Line 10 is edited, then 11, then 10 again — the user came back, which is
    // what makes this dwelling rather than progress down the file.
    const hits = editLocality(
      input({
        snapshots: [snap(0, [10]), snap(90, [11]), snap(DWELL_MIN_SECONDS + 10, [10])],
      }),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.lineStart).toBe(10);
    expect(hits[0]?.lineEnd).toBe(11);
  });

  it('DOES NOT FIRE ON EDITS THAT NEVER COME BACK', () => {
    /*
     * The condition the adversarial case forced. Three lines in a row over four
     * minutes is somebody writing, and calling it a stuck point would mean
     * telling every careful user they were stuck.
     */
    const hits = editLocality(
      input({ snapshots: [snap(0, [10]), snap(120, [11]), snap(240, [12])] }),
    );

    expect(hits).toEqual([]);
  });

  it('does NOT fire when the same edits happen quickly', () => {
    // Locality is about duration. Three fast edits are churn, not dwell.
    const hits = editLocality(input({ snapshots: [snap(0, [10]), snap(20, [11])] }));
    expect(hits).toEqual([]);
  });

  it('DOES NOT FIRE WHEN A RUN PASSED INSIDE THE WINDOW', () => {
    /*
     * The condition that separates working from struggling. Ten minutes in one
     * function ending in a pass is somebody finishing something, and reporting
     * it as a stuck point would make the feature useless to a competent user.
     */
    const hits = editLocality(
      input({
        snapshots: [snap(0, [10]), snap(150, [11]), snap(200, [10])],
        runs: [{ elapsedSeconds: 100, passed: true }],
      }),
    );

    expect(hits).toEqual([]);
  });

  it('splits when the edits move somewhere else', () => {
    const hits = editLocality(
      input({
        snapshots: [
          snap(0, [10]),
          snap(100, [11]),
          snap(200, [10]),
          snap(300, [30]),
          snap(400, [31]),
          snap(500, [30]),
        ],
      }),
    );

    expect(hits).toHaveLength(2);
    expect(hits[0]?.lineStart).toBe(10);
    expect(hits[1]?.lineStart).toBe(30);
  });

  it('rates a longer stretch more confidently', () => {
    const short = editLocality(
      input({ snapshots: [snap(0, [5]), snap(60, [6]), snap(DWELL_MIN_SECONDS + 1, [5])] }),
    );
    const long = editLocality(
      input({ snapshots: [snap(0, [5]), snap(60, [6]), snap(DWELL_MIN_SECONDS * 3, [5])] }),
    );

    expect(short[0]?.confidence).toBe('medium');
    expect(long[0]?.confidence).toBe('high');
  });
});

describe('F3.3 · signal 2 · edit churn', () => {
  it('FIRES on the third edit to one range', () => {
    const hits = editChurn(
      input({ snapshots: [snap(0, [20]), snap(10, [21]), snap(20, [20])] }),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.evidence[0]).toMatch(/changed 3 times/);
  });

  it('does not fire below the threshold', () => {
    const hits = editChurn(input({ snapshots: [snap(0, [20]), snap(10, [21])] }));
    expect(hits).toEqual([]);
    expect(CHURN_MIN_EDITS).toBe(3);
  });

  it('counts separate regions separately', () => {
    const hits = editChurn(
      input({
        snapshots: [snap(0, [5]), snap(1, [5]), snap(2, [5]), snap(3, [30]), snap(4, [30])],
      }),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.lineStart).toBe(5);
  });
});

describe('F3.3 · signal 3 · run-failure clustering', () => {
  it('FIRES on two consecutive failures with edits between them', () => {
    const hits = failureCluster(
      input({
        runs: [
          { elapsedSeconds: 100, passed: false },
          { elapsedSeconds: 200, passed: false },
        ],
        snapshots: [snap(150, [12])],
      }),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.evidence[0]).toMatch(/2 runs failed in a row/);
  });

  it('a pass breaks the streak', () => {
    const hits = failureCluster(
      input({
        runs: [
          { elapsedSeconds: 100, passed: false },
          { elapsedSeconds: 150, passed: true },
          { elapsedSeconds: 200, passed: false },
        ],
        snapshots: [snap(120, [12]), snap(180, [12])],
      }),
    );

    expect(hits).toEqual([]);
    expect(CLUSTER_MIN_FAILURES).toBe(2);
  });

  it('DOES NOT FIRE when nothing was edited between the failures', () => {
    /*
     * Running the same code twice is a different story — impatience, or a flaky
     * judge. There is no region to point at, and pointing at one anyway would
     * be inventing a location.
     */
    const hits = failureCluster(
      input({
        runs: [
          { elapsedSeconds: 100, passed: false },
          { elapsedSeconds: 200, passed: false },
        ],
        snapshots: [],
      }),
    );

    expect(hits).toEqual([]);
  });
});

describe('F3.3 · signal 4 · idle after failure', () => {
  it('FIRES on a long gap right after a failure', () => {
    const hits = idleAfterFailure(
      input({
        runs: [{ elapsedSeconds: 100, passed: false }],
        snapshots: [snap(90, [7])],
        events: [{ type: 'code_snapshot', elapsedSeconds: 100 + IDLE_MIN_SECONDS + 60 }],
      }),
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]?.lineStart).toBe(7);
  });

  it('IS ALWAYS LOW CONFIDENCE, however long the gap', () => {
    /*
     * The weakest thing in the module, and it stays weak. Silence after a
     * failure is equally consistent with thinking hard and with closing the
     * laptop, and no amount of it becomes evidence of the first.
     */
    const hits = idleAfterFailure(
      input({
        runs: [{ elapsedSeconds: 100, passed: false }],
        snapshots: [snap(90, [7])],
        events: [{ type: 'code_snapshot', elapsedSeconds: 100 + 3600 }],
        totalSeconds: 7200,
      }),
    );

    expect(hits[0]?.confidence).toBe('low');
  });

  it('does not fire after a passing run', () => {
    const hits = idleAfterFailure(
      input({
        runs: [{ elapsedSeconds: 100, passed: true }],
        snapshots: [snap(90, [7])],
        events: [{ type: 'session_completed', elapsedSeconds: 100 + IDLE_MIN_SECONDS + 60 }],
      }),
    );

    expect(hits).toEqual([]);
  });

  it('does not fire without an edit to point at', () => {
    const hits = idleAfterFailure(
      input({
        runs: [{ elapsedSeconds: 100, passed: false }],
        snapshots: [],
        events: [{ type: 'session_completed', elapsedSeconds: 900 }],
      }),
    );

    expect(hits).toEqual([]);
  });
});

describe('F3.3 · signal 5 · the user said so', () => {
  it('carries user_marked and no line range', () => {
    const hits = userMarkers(
      input({ markers: [{ elapsedSeconds: 300, category: 'implementation' }] }),
    );

    expect(hits[0]?.confidence).toBe('user_marked');
    // Zero means "no range" — F1.5 records a marker without asking where, and
    // inventing one would put words in the user's mouth.
    expect(hits[0]?.lineStart).toBe(0);
  });
});

describe('F3.3 · signals in combination', () => {
  const combined = input({
    snapshots: [snap(0, [12]), snap(60, [13]), snap(140, [12]), snap(200, [14])],
    runs: [
      { elapsedSeconds: 150, passed: false },
      { elapsedSeconds: 210, passed: false },
    ],
    events: [{ type: 'code_snapshot', elapsedSeconds: 400 }],
    markers: [{ elapsedSeconds: 250, category: 'debugging' }],
    totalSeconds: 600,
  });

  it('MERGES OVERLAPPING REGIONS INTO ONE FINDING', () => {
    // Locality, churn and the failure cluster all land on lines 12–14. Three
    // separate rows would double-count one struggle.
    const regions = rankRegions(combined, runSignals(combined));
    const inferred = regions.filter((region) => region.confidence !== 'user_marked');

    expect(inferred).toHaveLength(1);
    expect(inferred[0]?.signals.length).toBeGreaterThan(1);
  });

  it('RANKS THE USER MARKER FIRST, always', () => {
    const regions = rankRegions(combined, runSignals(combined));
    expect(regions[0]?.confidence).toBe('user_marked');
  });

  it('carries the evidence from every contributing signal', () => {
    const regions = rankRegions(combined, runSignals(combined));
    const merged = regions.find((region) => region.signals.length > 1);

    expect(merged?.evidence.length).toBeGreaterThanOrEqual(merged!.signals.length);
  });

  it('is deterministic — the same session ranks the same way every time', () => {
    const first = JSON.stringify(rankRegions(combined, runSignals(combined)));
    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(JSON.stringify(rankRegions(combined, runSignals(combined)))).toBe(first);
    }
  });
});

describe('F3.3 · ADVERSARIAL CASES', () => {
  it('a session with nothing in it produces nothing', () => {
    expect(rankRegions(input(), runSignals(input()))).toEqual([]);
  });

  it('a session with one keystroke produces nothing', () => {
    const one = input({ snapshots: [snap(5, [1])] });
    expect(rankRegions(one, runSignals(one))).toEqual([]);
  });

  it('A USER WHO TYPED CONTINUOUSLY ALL OVER THE FILE IS NOT REPORTED AS STUCK', () => {
    /*
     * The failure that would make this feature worthless: firing on everybody.
     * Edits marching down the file are someone writing a solution, and neither
     * locality nor churn should see a wall in that.
     */
    const typing = input({
      snapshots: Array.from({ length: 40 }, (_, n) => snap(n * 30, [n + 1])),
      totalSeconds: 1200,
    });

    const regions = rankRegions(typing, runSignals(typing));
    expect(regions).toEqual([]);
  });

  it('a user idle for the whole session is not reported as stuck', () => {
    // No failures, so nothing to be idle *after*. Silence alone is not a signal.
    const idle = input({
      events: [
        { type: 'session_started', elapsedSeconds: 0 },
        { type: 'session_abandoned', elapsedSeconds: 3600 },
      ],
      totalSeconds: 3600,
    });

    expect(rankRegions(idle, runSignals(idle))).toEqual([]);
  });

  it('a long successful session is not reported as stuck', () => {
    const productive = input({
      snapshots: [snap(0, [10]), snap(300, [11]), snap(600, [12])],
      runs: [
        { elapsedSeconds: 200, passed: true },
        { elapsedSeconds: 500, passed: true },
      ],
      totalSeconds: 900,
    });

    const regions = rankRegions(productive, runSignals(productive));
    expect(regions.filter((region) => region.confidence !== 'user_marked')).toEqual([]);
  });

  it('caps how much it will claim about one session', () => {
    // Twelve separate struggles is not a finding, it is noise.
    const scattered = input({
      snapshots: Array.from({ length: 60 }, (_, n) =>
        snap(n * 150, [Math.floor(n / 3) * 10 + 1]),
      ),
      totalSeconds: 10_000,
    });

    expect(rankRegions(scattered, runSignals(scattered)).length).toBeLessThanOrEqual(6);
  });
});
