/**
 * Streak freezes: allowance, eligibility, and what happens when a backfill
 * makes a covered day complete after all.
 *
 * ## The allowance is DERIVED, never stored (D18)
 *
 *   balance = MONTHLY_ALLOWANCE − (freezes covering days in that local month)
 *
 * A stored counter would need something to refill it, and **F2.3 is cut, so no
 * job is coming** (D17). A counter with no refiller is a number that silently
 * stops being true. Deriving it makes the refill a property of the query:
 * nothing to schedule, nothing to drift, and the month boundary is evaluated in
 * the user's own timezone like every other boundary in this module.
 *
 * ## Freezes are RE-DERIVED by every recompute, so a backfill releases one
 *
 * The question: a freeze covers missed day D; the user later backfills a
 * session for D; the freeze was spent on a day that turned out not to need it.
 * Does it come back?
 *
 * **It comes back** — and not as a refund mechanic. It follows from something
 * the module already guarantees.
 *
 * Recompute is a pure function of the day sequence. If a consumed freeze were
 * permanent, recompute would no longer be a function of the sessions alone: it
 * would depend on the ORDER things were logged. Two users with byte-identical
 * session histories would hold different freeze balances because one of them
 * logged a session late. That contradicts the idempotency the whole ticket is
 * built on, and it is a harder property to give up than "consumed is consumed".
 *
 * So coverage is recalculated from the days, and a day that no longer needs
 * covering no longer has a freeze against it. There is no gaming vector: to
 * release a freeze you must supply a real solve for that day, which is exactly
 * the day the freeze was standing in for.
 *
 * **What this costs:** the freeze log is a projection of current coverage, not
 * an append-only audit trail. We cannot answer "was a freeze ever applied to D
 * and later released?". With F4.3 cut there is no rewards system that would
 * care, and the acceptance criterion asks only that consumption appear in the
 * log with the date it covered — which it does.
 */
import { type LocalDate, localMonthOf } from './day';

/** Freezes granted per local month, per D18. Not configurable, not stored. */
export const MONTHLY_FREEZE_ALLOWANCE = 2;

/** One row of `streak_freezes`: the local date this freeze stands in for. */
export type FreezeCoverage = { coveredLocalDate: LocalDate };

/**
 * Freezes still available for the month containing `date`.
 *
 * Scoped per month, so covering two days in March leaves April untouched.
 */
export function freezeBalanceFor(date: LocalDate, coverage: readonly FreezeCoverage[]): number {
  const month = localMonthOf(date);
  const used = coverage.filter((row) => localMonthOf(row.coveredLocalDate) === month).length;
  return Math.max(0, MONTHLY_FREEZE_ALLOWANCE - used);
}

/**
 * May a freeze be applied to this day?
 *
 * `dayCompleted` being false is a precondition rather than an afterthought: the
 * spec calls out that a freeze must not apply to a day that was already
 * complete, which would burn one for nothing and is the difference between a
 * safety net and a tax.
 */
export function canFreeze(
  date: LocalDate,
  dayCompleted: boolean,
  coverage: readonly FreezeCoverage[],
): boolean {
  if (dayCompleted) return false;
  return freezeBalanceFor(date, coverage) > 0;
}

/**
 * Decide the full set of days a freeze should cover, given the completion map.
 *
 * Returns coverage in date order, consuming the monthly allowance as it walks
 * forward. Pure and total — the caller writes the difference against what is
 * stored, which is what makes recompute idempotent: the same day sequence
 * always yields the same coverage set, regardless of what was stored before.
 *
 * Walks forward rather than choosing optimally. A freeze covers the FIRST
 * eligible gap it meets, not the one that would extend the streak furthest.
 * Optimal assignment would mean a freeze's meaning changing retroactively as
 * later days arrive — the same order-dependence this file exists to avoid.
 */
export function coverageFor(
  days: readonly { date: LocalDate; completed: boolean }[],
): FreezeCoverage[] {
  const coverage: FreezeCoverage[] = [];

  for (const day of days) {
    if (day.completed) continue;
    if (!canFreeze(day.date, day.completed, coverage)) continue;
    coverage.push({ coveredLocalDate: day.date });
  }

  return coverage;
}
