import { notFound } from 'next/navigation';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { getAssessmentAttempt } from '@/server/services/assessments';
import { AssessmentWorkspace } from './AssessmentWorkspace';

export default async function AssessmentAttemptPage({
  params,
}: {
  params: Promise<{ attemptId: string }>;
}) {
  const user = await requireCurrentUser();
  const { attemptId } = await params;
  const data = await getAssessmentAttempt(getDb(), {
    userId: user.id,
    attemptId,
    now: new Date(),
  });
  if (!data) notFound();
  return (
    <AssessmentWorkspace
      answers={data.answers}
      attempt={{
        id: data.attempt.id,
        status: data.attempt.status,
        expiresAt: data.attempt.expiresAt.toISOString(),
        activeQuestionId: data.attempt.activeQuestionId,
        score: data.attempt.score,
        maximumScore: data.attempt.maximumScore,
      }}
      paper={{ title: data.paper.title, instructions: data.paper.instructions }}
      questions={data.questions}
      templates={data.templates}
    />
  );
}
