'use client';

/**
 * F2.2 speed mode · time left against the target.
 *
 * Seeded from the server's event-derived elapsed time at render, then ticked
 * locally for display only. Nothing is decided from this number: hit or miss is
 * computed server-side when the sitting completes, from the event log, so a
 * client that fiddles with its clock changes what it sees and nothing else.
 */
import { useEffect, useState } from 'react';
import { formatElapsed } from '@/lib/session/timer-bar-state';

export function SpeedCountdown({
  targetSeconds,
  elapsedSeconds,
  paused,
}: {
  targetSeconds: number;
  elapsedSeconds: number;
  paused: boolean;
}) {
  const [elapsed, setElapsed] = useState(elapsedSeconds);

  useEffect(() => setElapsed(elapsedSeconds), [elapsedSeconds]);

  useEffect(() => {
    if (paused) return;
    const handle = setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(handle);
  }, [paused]);

  const remaining = targetSeconds - elapsed;

  return (
    <p aria-live="off" className="font-mono text-sm tabular-nums">
      {remaining >= 0 ? (
        <>{formatElapsed(remaining)} left</>
      ) : (
        <span className="text-[var(--danger)]">{formatElapsed(-remaining)} over</span>
      )}
    </p>
  );
}
