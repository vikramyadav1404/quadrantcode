/**
 * The curated starter library — loader and validator.
 *
 * `data/library.json` is **deliberately short of the ticket's 100 problems**.
 * Filling it would mean generating URLs from memory, and a URL that looks right
 * and 404s is worse than an absent row: it is a broken link with our name on
 * it. C1 forbids inventing platform content, and a fabricated URL is exactly
 * that. The remainder is BLOCKED on a real list.
 *
 * Every row is validated on load rather than trusted, because this file is
 * hand-edited and the failure mode of a bad row is a broken link shown to a
 * user on their first day.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { normaliseProblemUrl } from './normalise-url';

/** Every library problem is a LeetCode slug; the URL is derived, never typed. */
export const LEETCODE_PROBLEM_URL = (slug: string) => `https://leetcode.com/problems/${slug}/`;

const problemSchema = z.object({
  slug: z
    .string()
    .min(1)
    // Canonical LeetCode slugs are lowercase, digits and hyphens. Anything else
    // is a typo, and a typo here is a 404 on a new user's first screen.
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'not a canonical slug'),
  title: z.string().min(1).max(200),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  estimatedMinutes: z.number().int().positive().max(180),
  topics: z.array(z.string().min(1)).min(1),
  /** The ticket requires at least one pattern tag per row. */
  patterns: z.array(z.string().min(1)).min(1),
});

const librarySchema = z.object({
  $comment: z.array(z.string()).optional(),
  sets: z
    .array(
      z.object({
        name: z.string().min(1),
        problems: z.array(problemSchema).min(1),
      }),
    )
    .min(1),
});

export type LibraryProblem = z.infer<typeof problemSchema> & {
  set: string;
  url: string;
  normalisedUrl: string;
};

export function loadLibrary(path = 'data/library.json'): LibraryProblem[] {
  const parsed = librarySchema.parse(JSON.parse(readFileSync(path, 'utf8')));

  const problems: LibraryProblem[] = [];
  for (const set of parsed.sets) {
    for (const problem of set.problems) {
      const url = LEETCODE_PROBLEM_URL(problem.slug);
      const normalisedUrl = normaliseProblemUrl(url);

      // Unreachable given the slug regex, and asserted anyway: if the two rules
      // ever disagree the row would import with a null dedup key.
      if (!normalisedUrl) throw new Error(`library: unusable URL for ${problem.slug}`);

      problems.push({ ...problem, set: set.name, url, normalisedUrl });
    }
  }
  return problems;
}
