import { notFound } from 'next/navigation';
import { UpsolveList } from '@/components/assessments/UpsolveList';
import { getDb } from '@/server/db';
import { requireCurrentUser } from '@/server/services/auth/session';
import { getAssessmentAttempt, getUpsolveQueue } from '@/server/services/assessments';
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

  // F4.5 · once the attempt is over, what it left unsolved. Not loaded while
  // the attempt is live: nothing is "unsolved" until time is up.
  const upsolve =
    data.attempt.status === 'in_progress'
      ? []
      : await getUpsolveQueue(getDb(), { userId: user.id, attemptId: data.attempt.id });

  return (
    <>
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
      <div className="mt-6">
        <UpsolveList
          heading="Your upsolve queue from this attempt"
          items={upsolve}
          showPaper={false}
        />
      </div>
    </>
  );
}
