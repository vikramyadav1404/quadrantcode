/**
 * "Find a small failing case" — after a failed Submit on one of our problems.
 *
 * The hidden tests stay hidden. Instead this generates fresh, tiny inputs,
 * runs the user's program on them through the execution provider and our
 * reference solution in-process, and reports the first input where the two
 * disagree — then tries to make it smaller by dropping one item at a time.
 * The input shown is one we just made up, never a stored test.
 *
 * Costs are bounded because every run lands on the execution VM: at most
 * `STRESS_MAX_RUNS` programs per search, `STRESS_CONCURRENCY` at a time, a
 * wall-clock deadline, `STRESS_DAILY_LIMIT` searches per user per day and
 * `STRESS_GLOBAL_LIMIT` searches across everyone per ten minutes. A result is
 * kept per job, so asking again costs nothing.
 *
 * Practice only: a job that belongs to a mock OA answer is refused.
 */
import { and, count, eq, gte, lt } from 'drizzle-orm';
import type { Database } from '@/server/db';
import {
  assessmentAnswers,
  executionJobs,
  problemLanguageTemplates,
  problemVersions,
  problems,
  runAttempts,
  stressSearches,
  type StressSearchResult,
} from '@/server/db/schema';
import {
  EXECUTION_LIMITS,
  type ExecutionProvider,
  type ExecutionResult,
} from '@/server/services/execution/provider';
import { outputsMatch, wrapUserSource } from '@/server/services/execution/native';
import type { ExecutionVerdict } from '@/lib/execution/languages';
import {
  STRESS_GENERATORS,
  createRng,
  shrinkCandidates,
  toStdin,
  type StressGenerator,
} from './generators';
import { runReference } from './reference';

export { STRESS_GENERATORS } from './generators';

export const STRESS_DAILY_LIMIT = 5;
export const STRESS_GLOBAL_LIMIT = 30;
export const STRESS_MAX_RUNS = 40;
export const STRESS_RANDOM_INPUTS = 24;
export const STRESS_CONCURRENCY = 3;
const DEADLINE_MS = 45_000;
const STALE_CLAIM_MS = 2 * 60_000;
const MAX_SHOWN_CHARS = 1_000;

export class StressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StressError';
  }
}

export type StressOutcome = {
  result: StressSearchResult;
  runs: number;
  remainingToday: number;
};

const startOfUtcDay = (now: Date) =>
  new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

/** A stable seed per job, so the same job searches the same inputs. */
function seedFor(jobId: string): number {
  let hash = 2166136261;
  for (const character of jobId) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

const shown = (text: string | null) =>
  text === null || text.trim() === '' ? null : text.trim().slice(0, MAX_SHOWN_CHARS);

type Candidate = { values: number[]; stdin: string; expected: string };

type Failure = Candidate & { actual: string | null; verdict: ExecutionVerdict };

/** The user's verdict on one input, or null when it matched the reference. */
function judge(candidate: Candidate, result: ExecutionResult): Failure | null {
  if (result.verdict === 'internal_error' || result.verdict === 'compile_error') {
    throw new StressError('The runner failed while searching. Try again in a moment.');
  }
  if (result.verdict === 'accepted' && outputsMatch(result.stdout, candidate.expected)) {
    return null;
  }
  return {
    ...candidate,
    actual: shown(result.stdout),
    verdict: result.verdict === 'accepted' ? 'wrong_answer' : result.verdict,
  };
}

/** Pure search loop, so it can be tested with a stub runner. */
export async function searchForFailure(input: {
  generator: StressGenerator;
  seed: number;
  reference: (stdin: string) => string;
  run: (stdin: string) => Promise<ExecutionResult>;
  maxRuns?: number;
  randomInputs?: number;
  concurrency?: number;
  deadline?: number;
}): Promise<{ failure: Failure | null; runs: number }> {
  const maxRuns = input.maxRuns ?? STRESS_MAX_RUNS;
  const concurrency = input.concurrency ?? STRESS_CONCURRENCY;
  const deadline = input.deadline ?? Number.POSITIVE_INFINITY;
  let runs = 0;

  const candidate = (values: number[]): Candidate | null => {
    const stdin = toStdin(values);
    try {
      return { values, stdin, expected: input.reference(stdin) };
    } catch {
      return null; // An input the reference cannot answer is skipped, never shown.
    }
  };

  /** The first failing candidate, in order, running a few at a time. */
  async function firstFailure(candidates: Candidate[]): Promise<Failure | null> {
    for (let start = 0; start < candidates.length; start += concurrency) {
      const room = maxRuns - runs;
      if (room <= 0 || Date.now() > deadline) return null;
      const batch = candidates.slice(start, start + Math.min(concurrency, room));
      runs += batch.length;
      const results = await Promise.all(batch.map((item) => input.run(item.stdin)));
      for (const [index, item] of batch.entries()) {
        const failure = judge(item, results[index]!);
        if (failure) return failure;
      }
    }
    return null;
  }

  // Small but not trivial: lengths up to 3…8, cycling. Lengths of 0–2 rarely show
  // a bug, and shrinking below makes whatever fails smaller afterwards.
  const seen = new Set<string>();
  const randoms: Candidate[] = [];
  for (let i = 0; i < (input.randomInputs ?? STRESS_RANDOM_INPUTS); i += 1) {
    const values = input.generator.generate(createRng(input.seed + i), 3 + (i % 6));
    const item = candidate(values);
    if (item && !seen.has(item.stdin)) {
      seen.add(item.stdin);
      randoms.push(item);
    }
  }

  let failure = await firstFailure(randoms);
  if (!failure) return { failure: null, runs };

  // Shrink: drop one item at a time while the smaller input still fails.
  for (;;) {
    const smaller = shrinkCandidates(input.generator, failure.values)
      .map(candidate)
      .filter((item): item is Candidate => item !== null && !seen.has(item.stdin));
    smaller.forEach((item) => seen.add(item.stdin));
    if (smaller.length === 0) break;
    const next = await firstFailure(smaller);
    if (!next) break;
    failure = next;
  }
  return { failure, runs };
}

async function searchesSince(db: Database, filter: { userId?: string; since: Date }) {
  const [row] = await db
    .select({ value: count() })
    .from(stressSearches)
    .where(
      and(
        gte(stressSearches.createdAt, filter.since),
        filter.userId ? eq(stressSearches.userId, filter.userId) : undefined,
      ),
    );
  return Number(row?.value ?? 0);
}

/** Whether a job can be searched — the button shows only when it can. */
export async function stressEligibility(
  db: Database,
  input: { userId: string; jobId: string },
): Promise<
  | { ok: false; reason: string }
  | {
      ok: true;
      job: { problemId: string; problemVersion: number; language: string; source: string };
      slug: string;
      cached: { result: StressSearchResult; runs: number } | null;
    }
> {
  const [job] = await db
    .select({
      userId: executionJobs.userId,
      problemId: executionJobs.problemId,
      problemVersion: executionJobs.problemVersion,
      language: executionJobs.language,
      mode: executionJobs.mode,
      source: executionJobs.source,
      slug: problems.slug,
      sourceType: problems.sourceType,
      verdict: runAttempts.verdict,
    })
    .from(executionJobs)
    .innerJoin(problems, eq(problems.id, executionJobs.problemId))
    .innerJoin(runAttempts, eq(runAttempts.jobId, executionJobs.id))
    .where(eq(executionJobs.id, input.jobId))
    .limit(1);

  if (!job || job.userId !== input.userId)
    return { ok: false, reason: 'That run was not found.' };
  if (job.sourceType !== 'original' || !STRESS_GENERATORS[job.slug]) {
    return { ok: false, reason: 'This search works only on Quadrantcode problems.' };
  }
  if (job.mode !== 'submit') return { ok: false, reason: 'Search after a Submit, not a Run.' };
  if (job.verdict === 'accepted') return { ok: false, reason: 'That submission passed.' };
  if (job.verdict === 'compile_error' || job.verdict === 'internal_error') {
    return { ok: false, reason: 'Fix the compile or runner error first.' };
  }

  const [inAssessment] = await db
    .select({ id: assessmentAnswers.id })
    .from(assessmentAnswers)
    .where(eq(assessmentAnswers.executionJobId, input.jobId))
    .limit(1);
  if (inAssessment) return { ok: false, reason: 'Not available during a mock OA.' };

  const [saved] = await db
    .select({
      status: stressSearches.status,
      result: stressSearches.result,
      runs: stressSearches.runs,
    })
    .from(stressSearches)
    .where(eq(stressSearches.jobId, input.jobId))
    .limit(1);

  return {
    ok: true,
    job,
    slug: job.slug,
    cached:
      saved?.status === 'done' && saved.result
        ? { result: saved.result, runs: saved.runs }
        : null,
  };
}

export async function findSmallFailingCase(
  db: Database,
  input: { userId: string; jobId: string; now: Date; provider: ExecutionProvider },
): Promise<StressOutcome> {
  const eligible = await stressEligibility(db, input);
  if (!eligible.ok) throw new StressError(eligible.reason);

  const usedToday = await searchesSince(db, {
    userId: input.userId,
    since: startOfUtcDay(input.now),
  });
  if (eligible.cached) {
    return {
      ...eligible.cached,
      remainingToday: Math.max(0, STRESS_DAILY_LIMIT - usedToday),
    };
  }
  if (!input.provider.executes) throw new StressError('Code execution is not available here.');
  if (usedToday >= STRESS_DAILY_LIMIT) {
    throw new StressError(`You have used all ${STRESS_DAILY_LIMIT} searches for today.`);
  }
  const recent = await searchesSince(db, {
    since: new Date(input.now.getTime() - 10 * 60_000),
  });
  if (recent >= STRESS_GLOBAL_LIMIT) {
    throw new StressError('The runner is busy. Try again in a few minutes.');
  }

  const { job, slug } = eligible;
  const [configuration] = await db
    .select({
      timeLimitMs: problemVersions.timeLimitMs,
      memoryLimitKb: problemVersions.memoryLimitKb,
    })
    .from(problemVersions)
    .where(
      and(
        eq(problemVersions.problemId, job.problemId),
        eq(problemVersions.version, job.problemVersion),
      ),
    )
    .limit(1);
  const templates = await templatesFor(db, job);
  const reference = templates.find((row) => row.language === 'javascript');
  const mine = templates.find((row) => row.language === job.language);
  if (!configuration || !reference || !mine) {
    throw new StressError('This problem is not set up for the search.');
  }

  // Claim the job; a claim left by a search that died is cleared after a while.
  await db
    .delete(stressSearches)
    .where(
      and(
        eq(stressSearches.jobId, input.jobId),
        eq(stressSearches.status, 'running'),
        lt(stressSearches.createdAt, new Date(input.now.getTime() - STALE_CLAIM_MS)),
      ),
    );
  const [claim] = await db
    .insert(stressSearches)
    .values({ jobId: input.jobId, userId: input.userId, createdAt: input.now })
    .onConflictDoNothing({ target: stressSearches.jobId })
    .returning({ id: stressSearches.id });
  if (!claim) throw new StressError('A search for this submission is already running.');

  const source = wrapUserSource(mine.wrapperTemplate, job.source, mine.language);
  const limits = {
    cpuSeconds: Math.max(
      0.1,
      Math.min(EXECUTION_LIMITS.cpuSeconds, configuration.timeLimitMs / 1_000),
    ),
    wallSeconds: Math.max(
      1,
      Math.min(EXECUTION_LIMITS.wallSeconds, Math.ceil(configuration.timeLimitMs / 1_000) + 1),
    ),
    memoryKb: Math.min(EXECUTION_LIMITS.memoryKb, configuration.memoryLimitKb),
  };

  try {
    const { failure, runs } = await searchForFailure({
      generator: STRESS_GENERATORS[slug]!,
      seed: seedFor(input.jobId),
      reference: (stdin) =>
        runReference({
          wrapperTemplate: reference.wrapperTemplate,
          referenceSolution: reference.referenceSolution,
          stdin,
        }),
      run: (stdin) =>
        input.provider.execute({
          language: mine.language,
          source,
          stdin,
          expectedOutput: null,
          limits,
        }),
      deadline: Date.now() + DEADLINE_MS,
    });
    const result: StressSearchResult = failure
      ? {
          found: true,
          input: failure.stdin,
          expected: failure.expected,
          actual: failure.actual,
          verdict: failure.verdict,
        }
      : { found: false };
    await db
      .update(stressSearches)
      .set({ status: 'done', result, runs, finishedAt: new Date() })
      .where(eq(stressSearches.id, claim.id));
    return { result, runs, remainingToday: Math.max(0, STRESS_DAILY_LIMIT - usedToday - 1) };
  } catch (error) {
    // Nothing found and nothing charged: the user gets the slot back.
    await db.delete(stressSearches).where(eq(stressSearches.id, claim.id));
    if (error instanceof StressError) throw error;
    throw new StressError('The runner is unavailable right now. Try again in a moment.');
  }
}

async function templatesFor(db: Database, job: { problemId: string; problemVersion: number }) {
  return db
    .select({
      language: problemLanguageTemplates.language,
      wrapperTemplate: problemLanguageTemplates.wrapperTemplate,
      referenceSolution: problemLanguageTemplates.referenceSolution,
    })
    .from(problemLanguageTemplates)
    .innerJoin(
      problemVersions,
      eq(problemVersions.id, problemLanguageTemplates.problemVersionId),
    )
    .where(
      and(
        eq(problemVersions.problemId, job.problemId),
        eq(problemVersions.version, job.problemVersion),
      ),
    );
}
