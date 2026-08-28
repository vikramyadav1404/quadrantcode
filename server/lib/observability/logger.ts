/**
 * Structured JSON logs, with the request id attached and PII removed.
 *
 * ## Every line has the same shape
 *
 * `timestamp, level, request_id, user_id, event, duration_ms` — the fields the
 * ticket names. A log where each line invents its own shape cannot be queried,
 * and a log nobody queries is a file that costs disk.
 *
 * `event` is a dotted name (`execution.job_failed`), not a sentence. Sentences
 * get reworded and break every saved search built on them.
 *
 * ## Redaction is not optional, and not the caller's job
 *
 * Everything passed as `fields` goes through `redact()`. There is no parameter
 * to skip it and no second function that does not. That is the whole point of
 * the ticket's "redact at the LOGGER level" — a rule applied at call sites
 * holds only until somebody adds a call site.
 *
 * ## Why `console` and not a library
 *
 * On Vercel, stdout IS the log pipeline; a library would add a dependency to
 * write to the same place. If this ever moves to a host that wants a different
 * transport, `emit` is the one function to change.
 */
import { redact } from './redact';
import { currentContext } from './trace';

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;

export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Record<string, unknown> & {
  /** How long the thing being reported took. Omitted when nothing was timed. */
  durationMs?: number;
};

type LogLine = {
  timestamp: string;
  level: LogLevel;
  requestId: string | null;
  userId: string | null;
  event: string;
  durationMs?: number;
  [key: string]: unknown;
};

/**
 * Below this, nothing is written.
 *
 * `debug` is noise in production and the only place it is useful is a machine
 * you can already attach to.
 */
function minimumLevel(): LogLevel {
  return process.env.NODE_ENV === 'production' ? 'info' : 'debug';
}

const RANK: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * The single place a log line leaves this process.
 *
 * Exported for the test, which needs to prove that what is actually WRITTEN
 * contains no PII — not that a redaction function exists.
 */
export function formatLine(level: LogLevel, event: string, fields: LogFields = {}): string {
  const context = currentContext();
  const { durationMs, ...rest } = fields;

  const line: LogLine = {
    timestamp: new Date().toISOString(),
    level,
    requestId: context?.requestId ?? null,
    // By ID only. The ticket says so for Sentry and it is true here too.
    userId: context?.userId ?? null,
    event,
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(redact(rest) as Record<string, unknown>),
  };

  return JSON.stringify(line);
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (RANK[level] < RANK[minimumLevel()]) return;

  const line = formatLine(level, event, fields);

  // stderr for anything that wants attention, stdout for the rest — so a host
  // that separates the two streams sorts them without configuration.
  if (level === 'error' || level === 'warn') console.error(line);
  else console.log(line);
}

export const log = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};

/**
 * Time something and log how long it took.
 *
 * Logs on failure too, with the error redacted — an operation that only reports
 * its duration when it succeeds hides exactly the slow paths worth finding.
 */
export async function timed<T>(event: string, fn: () => Promise<T>): Promise<T> {
  const started = Date.now();

  try {
    const result = await fn();
    log.info(event, { durationMs: Date.now() - started, ok: true });
    return result;
  } catch (error) {
    log.error(event, { durationMs: Date.now() - started, ok: false, error });
    throw error;
  }
}
