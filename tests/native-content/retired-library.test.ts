/**
 * F4.1 · the active library, and what was retired out of it.
 *
 * 94 of the original 100 records were ten tasks reskinned — same reference
 * solution, same contract, same worked example, different titles, and labelled
 * easy AND medium AND hard. 84 duplicates now sit in `data/native-problems/
 * retired/`, archived in the database and still in git, loaded by nothing.
 *
 * Two things need holding down. The first is that the retired folder really is
 * invisible to the loader — "it is ignored" is exactly the sort of claim that
 * passes because the test looked in the wrong place. The second is that a slug
 * cannot be in both, which is only worth asserting if the assertion can fail,
 * so there is a positive control for it.
 */
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  readdirSync,
  readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  NATIVE_PROBLEM_DATA_DIR,
  RETIRED_PROBLEM_DIR,
  loadNativeProblemBatches,
} from '@/server/services/native-content/load';
import {
  NATIVE_DIFFICULTY_DISTRIBUTION,
  NATIVE_TOPIC_DISTRIBUTION,
} from '@/server/services/native-content/schema';

const RETIRED_PATH = join(NATIVE_PROBLEM_DATA_DIR, RETIRED_PROBLEM_DIR);

function readSlugs(directory: string): string[] {
  return readdirSync(directory)
    .filter((name) => /^batch-\d+\.json$/.test(name))
    .flatMap((name) => {
      const payload = JSON.parse(readFileSync(join(directory, name), 'utf8')) as {
        problems: { slug: string }[];
      };
      return payload.problems.map((problem) => problem.slug);
    });
}

describe('F4.1 · the real library on disk', () => {
  it('loads exactly the active records, and none of the retired ones', async () => {
    const batches = await loadNativeProblemBatches();
    const loaded = batches.flatMap((batch) => batch.problems.map((problem) => problem.slug));
    const retired = readSlugs(RETIRED_PATH);

    expect(loaded).toHaveLength(16);
    expect(retired).toHaveLength(84);

    // The claim that matters: nothing retired came through the loader.
    for (const slug of retired) expect(loaded).not.toContain(slug);
  });

  it('the two sets are disjoint on disk', () => {
    const active = new Set(readSlugs(NATIVE_PROBLEM_DATA_DIR));
    const overlap = readSlugs(RETIRED_PATH).filter((slug) => active.has(slug));
    expect(overlap).toEqual([]);
  });

  it('every retired slug is still present in git-tracked content', () => {
    // Retired means relocated, not deleted. If this drops below 84 somebody
    // removed records rather than moving them.
    expect(readSlugs(RETIRED_PATH).length).toBe(84);
  });
});

describe('F4.1 · the re-based floors are met by the library they describe', () => {
  it('difficulty floors hold', async () => {
    const batches = await loadNativeProblemBatches();
    const counts: Record<string, number> = {};
    for (const batch of batches) {
      for (const problem of batch.problems) {
        counts[problem.difficulty] = (counts[problem.difficulty] ?? 0) + 1;
      }
    }
    for (const [level, floor] of Object.entries(NATIVE_DIFFICULTY_DISTRIBUTION)) {
      expect(counts[level] ?? 0, level).toBeGreaterThanOrEqual(floor);
    }
  });

  it('topic floors hold, and every declared topic is actually present', async () => {
    const batches = await loadNativeProblemBatches();
    const counts: Record<string, number> = {};
    for (const batch of batches) {
      for (const problem of batch.problems) {
        counts[problem.primaryTopic] = (counts[problem.primaryTopic] ?? 0) + 1;
      }
    }
    for (const [topic, floor] of Object.entries(NATIVE_TOPIC_DISTRIBUTION)) {
      expect(counts[topic] ?? 0, topic).toBeGreaterThanOrEqual(floor);
    }
  });

  it('the floors are not trivially satisfiable', () => {
    // A floor of 0 asserts nothing. This is what stopped the old constants
    // being quietly zeroed to make a failing library pass.
    for (const floor of Object.values(NATIVE_DIFFICULTY_DISTRIBUTION)) {
      expect(floor).toBeGreaterThan(0);
    }
    for (const floor of Object.values(NATIVE_TOPIC_DISTRIBUTION)) {
      expect(floor).toBeGreaterThan(0);
    }
  });
});

describe('F4.1 · the overlap guard can actually fail', () => {
  const made: string[] = [];

  afterEach(() => {
    for (const directory of made.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  /** A minimal library: one batch, copied from the real first active record. */
  function scratchLibrary(): { directory: string; slug: string } {
    const directory = mkdtempSync(join(tmpdir(), 'qc-lib-'));
    made.push(directory);

    const source = readdirSync(NATIVE_PROBLEM_DATA_DIR).find((name) =>
      /^batch-\d+\.json$/.test(name),
    )!;
    const payload = JSON.parse(readFileSync(join(NATIVE_PROBLEM_DATA_DIR, source), 'utf8')) as {
      schemaVersion: number;
      batch: number;
      reviewStatus: string;
      problems: { slug: string }[];
    };

    // The WHOLE active batch: a smaller slice breaches the difficulty floors
    // and `validateNativeLibrary` throws before the overlap check is reached,
    // which would make these tests pass for the wrong reason.
    writeFileSync(join(directory, 'batch-01.json'), JSON.stringify({ ...payload, batch: 1 }));
    return { directory, slug: payload.problems[0]!.slug };
  }

  it('loads cleanly when retired/ does not exist at all', async () => {
    const { directory } = scratchLibrary();
    await expect(loadNativeProblemBatches(directory)).resolves.toBeDefined();
  });

  it('loads cleanly when retired/ holds a DIFFERENT slug', async () => {
    const { directory } = scratchLibrary();
    const retired = join(directory, RETIRED_PROBLEM_DIR);
    mkdirSync(retired);
    const payload = JSON.parse(readFileSync(join(directory, 'batch-01.json'), 'utf8'));
    // EVERY slug has to differ — renaming one of sixteen leaves fifteen clashes
    // and the test would pass for the wrong reason.
    payload.problems = payload.problems.map((problem: { slug: string }, index: number) => ({
      ...problem,
      slug: `retired-only-${index}`,
    }));
    writeFileSync(join(retired, 'batch-09.json'), JSON.stringify(payload));

    await expect(loadNativeProblemBatches(directory)).resolves.toBeDefined();
  });

  it('THROWS when the same slug is in both', async () => {
    // The positive control. Without this the disjointness tests above could
    // be passing because the check never looks at anything.
    const { directory, slug } = scratchLibrary();
    const retired = join(directory, RETIRED_PROBLEM_DIR);
    mkdirSync(retired);
    writeFileSync(
      join(retired, 'batch-09.json'),
      readFileSync(join(directory, 'batch-01.json'), 'utf8'),
    );

    await expect(loadNativeProblemBatches(directory)).rejects.toThrow(
      new RegExp(`BOTH the active library and ${RETIRED_PROBLEM_DIR}`),
    );
    await expect(loadNativeProblemBatches(directory)).rejects.toThrow(slug);
  });
});
