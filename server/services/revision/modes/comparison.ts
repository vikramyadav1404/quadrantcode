/**
 * F2.2 · which revision mode is working for this user.
 *
 * Pure. The service supplies measured revisions; this decides what may be said
 * about them.
 *
 * ## What "retention" means here
 *
 * A revision sitting in mode M is *measured* once the user has attempted the
 * same problem again afterwards, and *retained* if that next attempt was
 * solved. It is the only retention signal the data holds without inventing one:
 * the question a revision answers is "will I still have it next time", and the
 * next time is the evidence. A revision with no later attempt yet is not a
 * failure — it is unmeasured, and it is left out rather than counted either way.
 *
 * ## When nothing may be claimed
 *
 * Under `MODE_COMPARISON_MINIMUM` measured revisions the answer is "not enough
 * data", never a percentage: three revisions naming a winner is noise presented
 * as a finding. Above it, every rate is reported beside its own sample size, and
 * a tie for the best rate names no winner.
 */
import {
  MODE_COMPARISON_MINIMUM,
  REVISION_MODES,
  type ModeComparisonView,
  type RevisionMode,
} from '@/lib/revision/modes';

export type MeasuredRevision = { mode: RevisionMode; retained: boolean };

export function compareModes(
  measured: readonly MeasuredRevision[],
  minimum: number = MODE_COMPARISON_MINIMUM,
): ModeComparisonView {
  if (measured.length < minimum) {
    return { enough: false, measured: measured.length, minimum };
  }

  const modes = REVISION_MODES.map((mode) => {
    const inMode = measured.filter((revision) => revision.mode === mode);
    return {
      mode,
      measured: inMode.length,
      retained: inMode.filter((revision) => revision.retained).length,
    };
  });

  const rated = modes.filter((stat) => stat.measured > 0);
  const rate = (stat: { measured: number; retained: number }) => stat.retained / stat.measured;
  const top = Math.max(...rated.map(rate));
  const leaders = rated.filter((stat) => rate(stat) === top);

  return {
    enough: true,
    measured: measured.length,
    modes,
    best: leaders.length === 1 ? leaders[0]!.mode : null,
  };
}

/**
 * Pair each revision sitting with the attempt that followed it.
 *
 * `sittings` are this user's finished, non-abandoned sessions on the problems
 * in question, in any order. For each revision sitting, the measure is the
 * EARLIEST later sitting on the same problem — of any kind, revision or not,
 * since what matters is whether the problem was still held.
 */
export function measureRevisions(
  sittings: readonly {
    problemId: string;
    startedAt: Date;
    status: 'solved' | 'stuck';
    revisionMode: RevisionMode | null;
  }[],
): MeasuredRevision[] {
  const byProblem = new Map<string, typeof sittings>();
  for (const sitting of sittings) {
    const bucket = byProblem.get(sitting.problemId);
    byProblem.set(sitting.problemId, bucket ? [...bucket, sitting] : [sitting]);
  }

  const measured: MeasuredRevision[] = [];
  for (const bucket of byProblem.values()) {
    const ordered = [...bucket].sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
    ordered.forEach((sitting, index) => {
      const next = ordered[index + 1];
      if (sitting.revisionMode && next) {
        measured.push({ mode: sitting.revisionMode, retained: next.status === 'solved' });
      }
    });
  }
  return measured;
}
