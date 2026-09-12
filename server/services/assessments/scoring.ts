import { and, eq } from 'drizzle-orm';
import type { Transaction } from '@/server/db';
import { assessmentAnswers, assessmentPaperQuestions } from '@/server/db/schema';
import type { ExecutionVerdict } from '@/lib/execution/languages';

export async function syncAssessmentAnswerForExecutionTx(
  tx: Transaction,
  input: { executionJobId: string; verdict: ExecutionVerdict; now: Date },
): Promise<void> {
  const [answer] = await tx
    .select({ id: assessmentAnswers.id, marks: assessmentPaperQuestions.marks })
    .from(assessmentAnswers)
    .innerJoin(
      assessmentPaperQuestions,
      eq(assessmentPaperQuestions.id, assessmentAnswers.paperQuestionId),
    )
    .where(eq(assessmentAnswers.executionJobId, input.executionJobId))
    .limit(1);
  if (!answer) return;
  await tx
    .update(assessmentAnswers)
    .set({
      verdict: input.verdict,
      marksAwarded: input.verdict === 'accepted' ? answer.marks : 0,
      submittedAt: input.now,
      updatedAt: input.now,
    })
    .where(
      and(
        eq(assessmentAnswers.id, answer.id),
        eq(assessmentAnswers.executionJobId, input.executionJobId),
      ),
    );
}
