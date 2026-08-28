/**
 * F4.6 · each of the four alert conditions fires when triggered.
 *
 * The criterion asks exactly that, and it is why the rules are pure: a
 * condition tangled up with its delivery can only be tested by delivering it
 * somewhere. These trigger with numbers.
 *
 * **What this does NOT prove is that anybody would be told.** There is no
 * destination — `deliver` writes a log line, and a log line is not an alert.
 * That half is BLOCKED and recorded as such.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_BUDGET_THRESHOLD,
  ALERT_KINDS,
  JUDGE0_ERROR_THRESHOLD,
  evaluateAlerts,
  type AlertInputs,
} from '@/server/lib/observability/alerts';

/** Nothing configured — the state this deployment is actually in. */
const QUIET: AlertInputs = {
  aiSpend: null,
  deadLetterCount: null,
  judge0: null,
  webhookFailures: null,
};

describe('F4.6 · each condition fires', () => {
  it('AI budget at 80%', () => {
    const alerts = evaluateAlerts({ ...QUIET, aiSpend: { spent: 80, budget: 100 } });

    expect(alerts.map((alert) => alert.kind)).toEqual(['ai_budget']);
    expect(alerts[0]?.message).toMatch(/80%/);
  });

  it('a non-empty dead-letter queue', () => {
    const alerts = evaluateAlerts({ ...QUIET, deadLetterCount: 3 });
    expect(alerts.map((alert) => alert.kind)).toEqual(['dead_letter']);
  });

  it('Judge0 failing more than a tenth of the time', () => {
    const alerts = evaluateAlerts({ ...QUIET, judge0: { failed: 3, total: 20 } });
    expect(alerts.map((alert) => alert.kind)).toEqual(['judge0_error_rate']);
  });

  it('ANY webhook signature failure, not a rate', () => {
    // A signature that does not verify is a misconfiguration or a forgery, and
    // neither gets quieter by happening less often.
    const alerts = evaluateAlerts({ ...QUIET, webhookFailures: 1 });
    expect(alerts.map((alert) => alert.kind)).toEqual(['webhook_signature']);
  });

  it('all four at once', () => {
    const alerts = evaluateAlerts({
      aiSpend: { spent: 100, budget: 100 },
      deadLetterCount: 1,
      judge0: { failed: 10, total: 10 },
      webhookFailures: 2,
    });

    expect(alerts.map((alert) => alert.kind).sort()).toEqual([...ALERT_KINDS].sort());
  });
});

describe('F4.6 · and stays quiet otherwise', () => {
  it('NOTHING CONFIGURED IS NOT AN ALERT', () => {
    /*
     * The state this deployment is in. A `0` for a dead-letter queue that does
     * not exist would be a reassurance about a thing that is not there — the
     * same reason the health dashboard lists those panels as absent rather than
     * green.
     */
    expect(evaluateAlerts(QUIET)).toEqual([]);
  });

  it('below each threshold, nothing fires', () => {
    expect(evaluateAlerts({ ...QUIET, aiSpend: { spent: 79, budget: 100 } })).toEqual([]);
    expect(evaluateAlerts({ ...QUIET, deadLetterCount: 0 })).toEqual([]);
    expect(evaluateAlerts({ ...QUIET, judge0: { failed: 1, total: 20 } })).toEqual([]);
    expect(evaluateAlerts({ ...QUIET, webhookFailures: 0 })).toEqual([]);
  });

  it('sits exactly on each threshold and behaves as documented', () => {
    // 80% fires (>=), 10% does not (>). Both are deliberate and both are tested
    // rather than left for a reader to infer from the operator.
    expect(AI_BUDGET_THRESHOLD).toBe(0.8);
    expect(evaluateAlerts({ ...QUIET, aiSpend: { spent: 80, budget: 100 } })).toHaveLength(1);

    expect(JUDGE0_ERROR_THRESHOLD).toBe(0.1);
    expect(evaluateAlerts({ ...QUIET, judge0: { failed: 2, total: 20 } })).toEqual([]);
    expect(evaluateAlerts({ ...QUIET, judge0: { failed: 3, total: 20 } })).toHaveLength(1);
  });

  it('does not divide by zero on an empty window', () => {
    expect(evaluateAlerts({ ...QUIET, judge0: { failed: 0, total: 0 } })).toEqual([]);
    expect(evaluateAlerts({ ...QUIET, aiSpend: { spent: 5, budget: 0 } })).toEqual([]);
  });

  it('escalates the AI budget from warning to critical at 100%', () => {
    expect(evaluateAlerts({ ...QUIET, aiSpend: { spent: 85, budget: 100 } })[0]?.severity).toBe(
      'warning',
    );
    expect(
      evaluateAlerts({ ...QUIET, aiSpend: { spent: 120, budget: 100 } })[0]?.severity,
    ).toBe('critical');
  });
});
