/**
 * This week's focus, with the reason beside every line.
 *
 * ## The reason is not optional and not decoration
 *
 * The ticket's rule: *"If you cannot state the reason in one sentence, the rule
 * is wrong."* So the type has no path that carries a recommendation without
 * one, and this component renders it unconditionally — there is no `?.` and no
 * fallback string, because a missing reason should be a type error rather than
 * a blank line in front of a user.
 */
import { readableCategory, type RecommendationView } from '@/lib/mistakes/view';

export function WeeklyPlan({
  recommendations,
  note,
}: {
  recommendations: RecommendationView[];
  note: string | null;
}) {
  if (recommendations.length === 0) {
    return (
      <p className="text-sm text-[var(--text-muted)]">
        {/* Said out loud. An empty panel reads like a bug. */}
        {note ?? 'Nothing to focus on this week.'}
      </p>
    );
  }

  return (
    <ol aria-label="This week's focus" className="flex flex-col gap-3">
      {recommendations.map((recommendation) => (
        <li
          className="rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-3"
          key={`${recommendation.category}-${recommendation.topic ?? 'none'}`}
        >
          <p className="font-medium">
            {recommendation.count} {recommendation.topic ? `${recommendation.topic} ` : ''}
            {recommendation.count === 1 ? 'problem' : 'problems'}, focusing on{' '}
            {readableCategory(recommendation.category).toLowerCase()}
          </p>
          <p className="mt-0.5 text-sm text-[var(--text-muted)]">{recommendation.reason}</p>
        </li>
      ))}
    </ol>
  );
}
