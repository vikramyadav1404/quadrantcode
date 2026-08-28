/**
 * How much a session costs to store, measured rather than guessed.
 *
 *   npm run snapshots:measure
 *
 * ## This measures SYNTHETIC sessions, and says so
 *
 * The ticket asks for "actual average bytes per session on real usage". **There
 * is no real usage** — nobody can sign in yet (Resend is blocked), so there is
 * no traffic to measure and there will not be until that credential exists.
 *
 * So this builds sessions that look like real ones — a solution written in
 * fifteen to forty edits, run several times, with the occasional rewrite — and
 * measures those. The README carries the number with that caveat attached,
 * because a storage projection presented as observed when it is generated is
 * exactly the kind of confident-looking figure this project has been bitten by.
 *
 * What IS real: the diff engine, the capture rules and `source_bytes` are the
 * production ones. Only the typing is invented.
 */
import 'dotenv/config';
import { diffLines, encodeDiff } from '@/server/services/timeline/diff';

/** A deterministic generator, so the published number is reproducible. */
function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

const STARTING_SOLUTION = [
  'class Solution:',
  '    def solve(self, nums: list[int], target: int) -> list[int]:',
  '        seen = {}',
  '        for index, value in enumerate(nums):',
  '            complement = target - value',
  '            if complement in seen:',
  '                return [seen[complement], index]',
  '            seen[value] = index',
  '        return []',
  '',
];

/** One session: a sequence of source versions, as a person would produce them. */
function session(seed: number): string[] {
  const random = rng(seed);
  const edits = 15 + Math.floor(random() * 26); // 15–40
  const versions: string[] = [STARTING_SOLUTION.join('\n')];

  for (let step = 0; step < edits; step += 1) {
    const lines = versions.at(-1)!.split('\n');
    const at = Math.floor(random() * lines.length);
    const choice = random();

    if (choice < 0.35) lines.splice(at, 0, `        # ${step}`);
    else if (choice < 0.5 && lines.length > 3) lines.splice(at, 1);
    else if (choice < 0.8) lines[at] = `${lines[at] ?? ''}  # ${step}`;
    else lines[at] = `        value = ${step}`;

    versions.push(lines.join('\n'));
  }

  return versions;
}

/** The production rule: store a diff unless it would be larger than the file. */
function storedBytes(versions: string[]): { stored: number; written: number; rows: number } {
  let stored = Buffer.byteLength(versions[0]!, 'utf8');
  let written = stored;
  let rows = 1;

  for (let index = 1; index < versions.length; index += 1) {
    const previous = versions[index - 1]!;
    const current = versions[index]!;
    if (previous === current) continue;

    const encoded = encodeDiff(diffLines(previous, current));
    const full = Buffer.byteLength(current, 'utf8');

    stored += encoded.length >= full ? full : Buffer.byteLength(encoded, 'utf8');
    written += full;
    rows += 1;
  }

  return { stored, written, rows };
}

function main(): void {
  const SESSIONS = 500;

  let stored = 0;
  let written = 0;
  let rows = 0;

  for (let seed = 1; seed <= SESSIONS; seed += 1) {
    const result = storedBytes(session(seed));
    stored += result.stored;
    written += result.written;
    rows += result.rows;
  }

  const perSession = stored / SESSIONS;
  const naivePerSession = written / SESSIONS;

  /*
   * The projection the ticket asks for. 1,000 monthly active users, at a rate
   * this project has no measurement for — so the arithmetic is shown with the
   * assumption named, rather than a single number presented as a finding.
   */
  const SESSIONS_PER_USER_PER_MONTH = 20;
  const MAU = 1_000;
  const monthlyBytes = perSession * SESSIONS_PER_USER_PER_MONTH * MAU;

  console.log(
    JSON.stringify(
      {
        note: 'SYNTHETIC sessions — there is no real usage to measure yet',
        sessions: SESSIONS,
        snapshotRowsPerSession: +(rows / SESSIONS).toFixed(1),
        storedBytesPerSession: Math.round(perSession),
        naiveBytesPerSession: Math.round(naivePerSession),
        savingVersusStoringEveryVersion: `${Math.round((1 - perSession / naivePerSession) * 100)}%`,
        projection: {
          assumedSessionsPerUserPerMonth: SESSIONS_PER_USER_PER_MONTH,
          monthlyActiveUsers: MAU,
          monthlyMB: +(monthlyBytes / 1_048_576).toFixed(1),
          ninetyDayMB: +((monthlyBytes * 3) / 1_048_576).toFixed(1),
        },
      },
      null,
      2,
    ),
  );
}

main();
