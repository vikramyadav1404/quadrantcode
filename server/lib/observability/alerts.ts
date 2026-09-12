/**
 * The four conditions worth waking someone for.
 *
 * ## Every condition is a pure function, and that is what makes them testable
 *
 * The criterion is that each of the four "fires when artificially triggered".
 * A condition tangled up with its delivery can only be tested by delivering it
 * somewhere — so the rules are pure, the sink is a seam, and the tests trigger
 * each rule with numbers rather than with an outage.
 *
 * ## The delivery half is BLOCKED, and this file does not pretend otherwise
 *
 * There is no `SENTRY_DSN`, no webhook, no email that reaches anybody. So the
 * default sink writes a log line. **A log line is not an alert** — nobody is
 * watching stdout at 3am — and calling this "alerting" without that sentence
 * would be the kind of claim F3.1 refused to make about its sandbox.
 *
 * When a destination exists, `deliver` is the one function to replace.
 */
import { log } from './logger';

export const ALERT_KINDS = [
  'ai_budget',
  'dead_letter',
  'judge0_error_rate',
  'webhook_signature',
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number];

export type Alert = {
  kind: AlertKind;
  severity: 'warning' | 'critical';
  /** What happened, with the number that triggered it. */
  message: string;
};

/** The AI budget is considered spent at this fraction. */
export const AI_BUDGET_THRESHOLD = 0.8;

/** Judge0 failures above this fraction, over the window, are an alert. */
export const JUDGE0_ERROR_THRESHOLD = 0.1;

/** How long a window the Judge0 rate is measured over. */
export const JUDGE0_WINDOW_MINUTES = 15;

export type AlertInputs = {
  /** Spend this month, and the budget. Null when there is no budget to breach. */
  aiSpend: { spent: number; budget: number } | null;
  /** Jobs in a dead-letter queue. Null when there is no queue (F2.3 is cut). */
  deadLetterCount: number | null;
  /** Judge0 outcomes in the window. Null when nothing has run. */
  judge0: { failed: number; total: number } | null;
  /** Webhook signature verifications that failed. Null when there are no webhooks. */
  webhookFailures: number | null;
};

/**
 * Which alerts the current numbers justify.
 *
 * `null` inputs produce NO alert, and that is different from a zero. Nothing
 * has a dead-letter queue, so "0 dead letters" would be a reassurance about a
 * thing that does not exist — the same reason the health dashboard lists those
 * panels as absent rather than green.
 */
export function evaluateAlerts(inputs: AlertInputs): Alert[] {
  const alerts: Alert[] = [];

  if (inputs.aiSpend && inputs.aiSpend.budget > 0) {
    const fraction = inputs.aiSpend.spent / inputs.aiSpend.budget;

    if (fraction >= AI_BUDGET_THRESHOLD) {
      alerts.push({
        kind: 'ai_budget',
        severity: fraction >= 1 ? 'critical' : 'warning',
        message: `AI spend is ${Math.round(fraction * 100)}% of the monthly budget.`,
      });
    }
  }

  if (inputs.deadLetterCount !== null && inputs.deadLetterCount > 0) {
    alerts.push({
      kind: 'dead_letter',
      severity: 'critical',
      message: `${inputs.deadLetterCount} jobs are in a dead-letter queue.`,
    });
  }

  if (inputs.judge0 && inputs.judge0.total > 0) {
    const rate = inputs.judge0.failed / inputs.judge0.total;

    if (rate > JUDGE0_ERROR_THRESHOLD) {
      alerts.push({
        kind: 'judge0_error_rate',
        severity: 'critical',
        message: `${Math.round(rate * 100)}% of executions failed in the last ${JUDGE0_WINDOW_MINUTES} minutes.`,
      });
    }
  }

  if (inputs.webhookFailures !== null && inputs.webhookFailures > 0) {
    /*
     * Any failure at all, not a rate. A webhook signature that does not verify
     * is either a misconfiguration or somebody forging one, and neither gets
     * quieter by happening less often.
     */
    alerts.push({
      kind: 'webhook_signature',
      severity: 'critical',
      message: `${inputs.webhookFailures} webhook signatures failed verification.`,
    });
  }

  return alerts;
}

/**
 * Where an alert goes.
 *
 * **Today: a log line, which is not an alert.** Nobody is watching stdout, and
 * the acceptance record says so rather than this function pretending. The seam
 * exists so that supplying a destination is a change to one function.
 */
export async function deliver(alert: Alert): Promise<void> {
  log.error('alert.raised', {
    kind: alert.kind,
    severity: alert.severity,
    message: alert.message,
    // Said in the payload as well as in this file's header, because whoever
    // finds this line in a log is the person who needed the alert.
    delivery: 'none configured — this is a log line, not a page',
  });
}

/** Evaluate and deliver in one call. Returns what fired, for the caller to show. */
export async function raiseAlerts(inputs: AlertInputs): Promise<Alert[]> {
  const alerts = evaluateAlerts(inputs);
  for (const alert of alerts) await deliver(alert);
  return alerts;
}
