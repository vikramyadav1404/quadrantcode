/**
 * Builds data/assessment-papers.json: general mock OAs from the original
 * problems. A general paper names no company (C3), so it needs no company
 * association and draws on the whole library.
 *
 * Each paper is one easy, two medium and one hard problem, four different
 * primary topics, and no problem appears in two papers. The paper count is
 * limited by the scarcest difficulty: every hard problem is used at most once.
 *
 * Deterministic: same library in, same papers out. Papers are append-only once
 * imported (the importer refuses a changed paper), so regenerate only when
 * adding new sets, and keep existing slugs and their questions unchanged.
 */
import { writeFile } from 'node:fs/promises';
import {
  MAX_GENERAL_PAPERS,
  assessmentPaperLibrarySchema,
} from '@/server/services/assessments';
import { loadNativeProblemBatches } from '@/server/services/native-content';

type Problem = { slug: string; difficulty: string; primaryTopic: string };

const SHAPE = ['easy', 'medium', 'medium', 'hard'] as const;
const MARKS = [20, 25, 25, 30] as const;

const batches = await loadNativeProblemBatches();
const problems: Problem[] = batches.flatMap((batch) => batch.problems);

const byDifficulty = (difficulty: string) =>
  problems.filter((problem) => problem.difficulty === difficulty);
const target = Math.min(
  MAX_GENERAL_PAPERS,
  byDifficulty('easy').length,
  Math.floor(byDifficulty('medium').length / 2),
  byDifficulty('hard').length,
);

/** Depth-first: fill paper after paper, slot after slot, backtracking on a dead end. */
function build(): Problem[][] | null {
  const used = new Set<string>();
  const papers: Problem[][] = [];

  function fill(current: Problem[]): boolean {
    if (papers.length === target) return true;
    if (current.length === SHAPE.length) {
      papers.push(current);
      if (fill([])) return true;
      papers.pop();
      return false;
    }
    const topics = new Set(current.map((problem) => problem.primaryTopic));
    const difficulty = SHAPE[current.length]!;
    // The second medium comes after the first in library order, so the same
    // pair is never tried twice in swapped slots.
    const floor =
      current.length === 2 ? problems.findIndex((problem) => problem === current[1]) : -1;
    for (const [index, problem] of problems.entries()) {
      if (
        index <= floor ||
        problem.difficulty !== difficulty ||
        used.has(problem.slug) ||
        topics.has(problem.primaryTopic)
      )
        continue;
      used.add(problem.slug);
      if (fill([...current, problem])) return true;
      used.delete(problem.slug);
    }
    return false;
  }

  return fill([]) ? papers : null;
}

const selected = build();
if (!selected) throw new Error(`Could not assemble ${target} general papers.`);

const papers = selected.map((questions, index) => {
  const set = String(index + 1).padStart(2, '0');
  return {
    slug: `general-mock-oa-${set}`,
    title: `Quadrantcode Mock OA ${set}`,
    role: 'Software Engineer',
    patternPeriod: `General online assessment practice — Set ${set}`,
    paperType: 'pattern_based_mock' as const,
    durationMinutes: 90,
    instructions:
      'A timed online-assessment practice paper built entirely from original Quadrantcode problems. ' +
      'It is not modelled on, or endorsed by, any employer, and none of its questions is a past paper. ' +
      'Four questions — one easy, two medium, one hard — in 90 minutes, on a server-side clock. ' +
      'Run Code uses the visible or your own cases; Submit Question uses the complete protected test set. ' +
      'Only server-verified submissions count towards the score.',
    status: 'needs_review' as const,
    version: 1,
    provenance: {
      contentSource: 'quadrantcode-original' as const,
      independentlyCreated: true as const,
      licenseName: 'Quadrantcode Original Practice Content License',
      author: 'Quadrantcode editorial team',
      note: 'Assembled from Quadrantcode-original problems as a general online-assessment practice paper; names no company.',
    },
    questions: questions.map((problem, position) => ({
      problemSlug: problem.slug,
      ordinal: position + 1,
      marks: MARKS[position]!,
    })),
  };
});

const library = assessmentPaperLibrarySchema.parse({
  schemaVersion: 1,
  reviewStatus: 'needs_review',
  papers,
});

await writeFile('data/assessment-papers.json', `${JSON.stringify(library, null, 2)}\n`);
console.log(`validated ${library.papers.length} general mock OA papers`);
