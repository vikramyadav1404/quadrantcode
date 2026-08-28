'use client';

/**
 * The form, plus where the user goes afterwards.
 *
 * Saving and skipping both land on the problem page, where the attempt they
 * just finished is now the top row of the history. That is the point of coming
 * back: the reflection is not a form to be filed away, it is the thing that
 * makes the next attempt's panel worth reading.
 *
 * Navigation lives in this thin client wrapper so the form itself stays a form
 * — it takes props and returns a result, and knows nothing about routing.
 */
import { useRouter } from 'next/navigation';
import { ReflectionForm, type ReflectionInitial } from '@/components/session/ReflectionForm';
import type { MistakeCategory, StuckCategory } from '@/lib/reflection/taxonomy';

export function ReflectRedirect({
  sessionId,
  problemSlug,
  initial,
  onSave,
}: {
  sessionId: string;
  problemSlug: string;
  initial: ReflectionInitial;
  onSave: (input: {
    sessionId: string;
    approach?: string;
    achievedComplexity?: string;
    stuckAreas: StuckCategory[];
    mistakes: MistakeCategory[];
    confidence?: 'low' | 'medium' | 'high';
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const done = () => router.push(`/problems/${problemSlug}`);

  return (
    <ReflectionForm
      initial={initial}
      onSave={async (input) => {
        const result = await onSave(input);
        if (result.ok) done();
        return result;
      }}
      onSkip={done}
      sessionId={sessionId}
    />
  );
}
