import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import type { Database, Transaction } from '@/server/db';
import {
  assessmentAnswers,
  assessmentAttempts,
  assessmentPaperQuestions,
  assessmentPapers,
  problemLanguageTemplates,
  problemVersions,
  problems,
  runAttempts,
} from '@/server/db/schema';
import type { ExecutionRunner } from '@/server/services/execution/pipeline';
import { submitExecution } from '@/server/services/execution/pipeline';
import { assessmentAnswerSchema } from './input';
import type { ExecutionLanguage } from '@/lib/execution/languages';

type AttemptRow = typeof assessmentAttempts.$inferSelect;

export async function startOrResumeAssessment(
  db: Database,
  input: { userId: string; paperId: string; now: Date },
): Promise<{ attemptId: string; resumed: boolean }> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtext(${`${input.userId}:${input.paperId}`}))`,
    );
    const [existing] = await tx
      .select()
      .from(assessmentAttempts)
      .where(
        and(
          eq(assessmentAttempts.userId, input.userId),
          eq(assessmentAttempts.paperId, input.paperId),
          eq(assessmentAttempts.status, 'in_progress'),
        ),
      )
      .orderBy(desc(assessmentAttempts.startedAt))
      .limit(1);

    if (existing && existing.expiresAt > input.now) {
      return { attemptId: existing.id, resumed: true };
    }
    if (existing) await finalizeTx(tx, existing, input.now, true);

    const [paper] = await tx
      .select({
        id: assessmentPapers.id,
        durationMinutes: assessmentPapers.durationMinutes,
      })
      .from(assessmentPapers)
      .where(
        and(eq(assessmentPapers.id, input.paperId), eq(assessmentPapers.status, 'published')),
      )
      .limit(1);
    if (!paper) throw new Error('No published assessment paper was found.');

    const questions = await tx
      .select({ id: assessmentPaperQuestions.id, marks: assessmentPaperQuestions.marks })
      .from(assessmentPaperQuestions)
      .where(eq(assessmentPaperQuestions.paperId, paper.id))
      .orderBy(asc(assessmentPaperQuestions.ordinal));
    if (questions.length === 0) throw new Error('This paper has no questions.');

    const maximumScore = questions.reduce((sum, question) => sum + question.marks, 0);
    const expiresAt = new Date(input.now.getTime() + paper.durationMinutes * 60_000);
    const [attempt] = await tx
      .insert(assessmentAttempts)
      .values({
        paperId: paper.id,
        userId: input.userId,
        startedAt: input.now,
        expiresAt,
        activeQuestionId: questions[0]!.id,
        lastInteractionAt: input.now,
        maximumScore,
      })
      .returning({ id: assessmentAttempts.id });
    await ensureAnswer(tx, attempt!.id, questions[0]!.id);
    return { attemptId: attempt!.id, resumed: false };
  });
}

export async function getAssessmentAttempt(
  db: Database,
  input: { userId: string; attemptId: string; now: Date },
) {
  let [attempt] = await db
    .select()
    .from(assessmentAttempts)
    .where(
      and(
        eq(assessmentAttempts.id, input.attemptId),
        eq(assessmentAttempts.userId, input.userId),
      ),
    )
    .limit(1);
  if (!attempt) return null;
  if (attempt.status === 'in_progress' && attempt.expiresAt <= input.now) {
    await finalizeAssessment(db, input);
    [attempt] = await db
      .select()
      .from(assessmentAttempts)
      .where(eq(assessmentAttempts.id, input.attemptId))
      .limit(1);
  }

  const [paper] = await db
    .select({
      id: assessmentPapers.id,
      title: assessmentPapers.title,
      instructions: assessmentPapers.instructions,
      durationMinutes: assessmentPapers.durationMinutes,
    })
    .from(assessmentPapers)
    .where(eq(assessmentPapers.id, attempt!.paperId))
    .limit(1);
  const questions = await db
    .select({
      id: assessmentPaperQuestions.id,
      ordinal: assessmentPaperQuestions.ordinal,
      marks: assessmentPaperQuestions.marks,
      problemId: problems.id,
      slug: problems.slug,
      title: problems.title,
      difficulty: problems.difficulty,
      statement: problems.statement,
    })
    .from(assessmentPaperQuestions)
    .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
    .where(eq(assessmentPaperQuestions.paperId, attempt!.paperId))
    .orderBy(asc(assessmentPaperQuestions.ordinal));
  const answers = await db
    .select({
      id: assessmentAnswers.id,
      paperQuestionId: assessmentAnswers.paperQuestionId,
      language: assessmentAnswers.language,
      source: assessmentAnswers.source,
      verdict: assessmentAnswers.verdict,
      marksAwarded: assessmentAnswers.marksAwarded,
      timeSpentSeconds: assessmentAnswers.timeSpentSeconds,
      executionJobId: assessmentAnswers.executionJobId,
    })
    .from(assessmentAnswers)
    .where(eq(assessmentAnswers.attemptId, attempt!.id));
  const problemIds = questions.map((question) => question.problemId);
  const templates =
    problemIds.length === 0
      ? []
      : await db
          .select({
            problemId: problems.id,
            language: problemLanguageTemplates.language,
            starterCode: problemLanguageTemplates.starterCode,
          })
          .from(problems)
          .innerJoin(
            problemVersions,
            and(
              eq(problemVersions.problemId, problems.id),
              eq(problemVersions.version, problems.currentVersion),
            ),
          )
          .innerJoin(
            problemLanguageTemplates,
            eq(problemLanguageTemplates.problemVersionId, problemVersions.id),
          )
          .where(inArray(problems.id, problemIds));
  return {
    attempt: attempt!,
    paper: paper!,
    questions,
    answers,
    templates,
    remainingSeconds:
      attempt!.status === 'in_progress'
        ? Math.max(0, Math.ceil((attempt!.expiresAt.getTime() - input.now.getTime()) / 1_000))
        : 0,
    solutionsAvailable: attempt!.status !== 'in_progress',
  };
}

export async function switchAssessmentQuestion(
  db: Database,
  input: { userId: string; attemptId: string; paperQuestionId: string; now: Date },
): Promise<void> {
  await db.transaction(async (tx) => {
    const attempt = await lockOwnedAttempt(tx, input.userId, input.attemptId);
    if (attempt.expiresAt <= input.now) {
      await finalizeTx(tx, attempt, input.now, true);
      throw new Error('The assessment time has expired.');
    }
    const [question] = await tx
      .select({ id: assessmentPaperQuestions.id })
      .from(assessmentPaperQuestions)
      .where(
        and(
          eq(assessmentPaperQuestions.id, input.paperQuestionId),
          eq(assessmentPaperQuestions.paperId, attempt.paperId),
        ),
      )
      .limit(1);
    if (!question) throw new Error('That question is not part of this paper.');
    await creditActiveQuestion(tx, attempt, input.now);
    await ensureAnswer(tx, attempt.id, input.paperQuestionId);
    await tx
      .update(assessmentAttempts)
      .set({ activeQuestionId: input.paperQuestionId, lastInteractionAt: input.now })
      .where(eq(assessmentAttempts.id, attempt.id));
  });
}

export async function saveAssessmentAnswer(
  db: Database,
  userId: string,
  rawInput: unknown,
  now: Date,
): Promise<void> {
  const input = assessmentAnswerSchema.parse(rawInput);
  await switchAssessmentQuestion(db, {
    userId,
    attemptId: input.attemptId,
    paperQuestionId: input.paperQuestionId,
    now,
  });
  await db
    .update(assessmentAnswers)
    .set({ language: input.language, source: input.source, updatedAt: now })
    .where(
      and(
        eq(assessmentAnswers.attemptId, input.attemptId),
        eq(assessmentAnswers.paperQuestionId, input.paperQuestionId),
      ),
    );
}

export async function runAssessmentAnswer(
  db: Database,
  input: {
    userId: string;
    attemptId: string;
    paperQuestionId: string;
    language: ExecutionLanguage;
    source: string;
    submit: boolean;
    now: Date;
    runner: ExecutionRunner;
  },
) {
  await saveAssessmentAnswer(db, input.userId, input, input.now);
  const [question] = await db
    .select({ problemId: assessmentPaperQuestions.problemId })
    .from(assessmentPaperQuestions)
    .innerJoin(
      assessmentAttempts,
      eq(assessmentAttempts.paperId, assessmentPaperQuestions.paperId),
    )
    .where(
      and(
        eq(assessmentPaperQuestions.id, input.paperQuestionId),
        eq(assessmentAttempts.id, input.attemptId),
        eq(assessmentAttempts.userId, input.userId),
        eq(assessmentAttempts.status, 'in_progress'),
      ),
    )
    .limit(1);
  if (!question) throw new Error('The assessment is no longer active.');
  const result = await submitExecution(db, {
    userId: input.userId,
    problemId: question.problemId,
    language: input.language,
    mode: input.submit ? 'assessment' : 'run',
    source: input.source,
    stdin: null,
    now: input.now,
    runner: input.runner,
  });
  if (result.ok && input.submit) {
    await db
      .update(assessmentAnswers)
      .set({ executionJobId: result.jobId, updatedAt: input.now })
      .where(
        and(
          eq(assessmentAnswers.attemptId, input.attemptId),
          eq(assessmentAnswers.paperQuestionId, input.paperQuestionId),
        ),
      );
  }
  return result;
}

export async function finalizeAssessment(
  db: Database,
  input: { userId: string; attemptId: string; now: Date },
) {
  return db.transaction(async (tx) => {
    const attempt = await lockOwnedAttempt(tx, input.userId, input.attemptId, true);
    return finalizeTx(tx, attempt, input.now, attempt.expiresAt <= input.now);
  });
}

export async function sweepExpiredAssessments(db: Database, now: Date): Promise<number> {
  const expired = await db
    .select({ id: assessmentAttempts.id, userId: assessmentAttempts.userId })
    .from(assessmentAttempts)
    .where(
      and(eq(assessmentAttempts.status, 'in_progress'), lte(assessmentAttempts.expiresAt, now)),
    );
  for (const attempt of expired) {
    await finalizeAssessment(db, { userId: attempt.userId, attemptId: attempt.id, now });
  }
  return expired.length;
}

async function lockOwnedAttempt(
  tx: Transaction,
  userId: string,
  attemptId: string,
  allowTerminal = false,
): Promise<AttemptRow> {
  const [attempt] = await tx
    .select()
    .from(assessmentAttempts)
    .where(and(eq(assessmentAttempts.id, attemptId), eq(assessmentAttempts.userId, userId)))
    .for('update')
    .limit(1);
  if (!attempt) throw new Error('No such assessment attempt.');
  if (!allowTerminal && attempt.status !== 'in_progress') {
    throw new Error('The assessment is no longer active.');
  }
  return attempt;
}

async function creditActiveQuestion(
  tx: Transaction,
  attempt: AttemptRow,
  now: Date,
): Promise<void> {
  if (!attempt.activeQuestionId) return;
  const effectiveNow = new Date(Math.min(now.getTime(), attempt.expiresAt.getTime()));
  const seconds = Math.max(
    0,
    Math.floor((effectiveNow.getTime() - attempt.lastInteractionAt.getTime()) / 1_000),
  );
  if (seconds > 0) {
    await tx
      .update(assessmentAnswers)
      .set({
        timeSpentSeconds: sql`${assessmentAnswers.timeSpentSeconds} + ${seconds}`,
        updatedAt: effectiveNow,
      })
      .where(
        and(
          eq(assessmentAnswers.attemptId, attempt.id),
          eq(assessmentAnswers.paperQuestionId, attempt.activeQuestionId),
        ),
      );
  }
}

async function ensureAnswer(
  tx: Transaction,
  attemptId: string,
  paperQuestionId: string,
): Promise<void> {
  const [starter] = await tx
    .select({ source: problemLanguageTemplates.starterCode })
    .from(assessmentPaperQuestions)
    .innerJoin(problems, eq(problems.id, assessmentPaperQuestions.problemId))
    .innerJoin(
      problemVersions,
      and(
        eq(problemVersions.problemId, problems.id),
        eq(problemVersions.version, problems.currentVersion),
      ),
    )
    .innerJoin(
      problemLanguageTemplates,
      and(
        eq(problemLanguageTemplates.problemVersionId, problemVersions.id),
        eq(problemLanguageTemplates.language, 'cpp17'),
      ),
    )
    .where(eq(assessmentPaperQuestions.id, paperQuestionId))
    .limit(1);
  if (!starter) throw new Error('The question has no C++ starter template.');
  await tx
    .insert(assessmentAnswers)
    .values({
      attemptId,
      paperQuestionId,
      language: 'cpp17',
      source: starter.source,
    })
    .onConflictDoNothing();
}

async function finalizeTx(tx: Transaction, attempt: AttemptRow, now: Date, expired: boolean) {
  if (attempt.status !== 'in_progress') {
    return { score: attempt.score, maximumScore: attempt.maximumScore, status: attempt.status };
  }
  await creditActiveQuestion(tx, attempt, now);
  const answers = await tx
    .select({
      id: assessmentAnswers.id,
      verdict: runAttempts.verdict,
      serverVerified: runAttempts.serverVerified,
      marks: assessmentPaperQuestions.marks,
    })
    .from(assessmentAnswers)
    .innerJoin(
      assessmentPaperQuestions,
      eq(assessmentPaperQuestions.id, assessmentAnswers.paperQuestionId),
    )
    .leftJoin(runAttempts, eq(runAttempts.jobId, assessmentAnswers.executionJobId))
    .where(eq(assessmentAnswers.attemptId, attempt.id));
  let score = 0;
  const verdictBreakdown: Record<string, number> = {};
  for (const answer of answers) {
    const verifiedVerdict = answer.serverVerified ? answer.verdict : null;
    const label = verifiedVerdict ?? 'not_submitted';
    verdictBreakdown[label] = (verdictBreakdown[label] ?? 0) + 1;
    const marks = verifiedVerdict === 'accepted' ? answer.marks : 0;
    score += marks;
    await tx
      .update(assessmentAnswers)
      .set({ marksAwarded: marks, updatedAt: now })
      .where(eq(assessmentAnswers.id, answer.id));
  }
  const status = expired ? 'auto_submitted' : 'submitted';
  await tx
    .update(assessmentAttempts)
    .set({
      status,
      submittedAt: now,
      score,
      verdictBreakdown,
      lastInteractionAt: new Date(Math.min(now.getTime(), attempt.expiresAt.getTime())),
      updatedAt: now,
    })
    .where(eq(assessmentAttempts.id, attempt.id));
  return { score, maximumScore: attempt.maximumScore, status };
}
