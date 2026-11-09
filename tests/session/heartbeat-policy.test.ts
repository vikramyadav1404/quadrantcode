import { describe, expect, it } from 'vitest';
import { heartbeatEndedActivity, shouldSendHeartbeat } from '@/lib/session/heartbeat-policy';

describe('heartbeat policy', () => {
  it('a hidden tab sends nothing', () => {
    expect(shouldSendHeartbeat('hidden')).toBe(false);
  });

  it('a visible tab beats, and so does an environment that cannot say', () => {
    expect(shouldSendHeartbeat('visible')).toBe(true);
    // No Page Visibility API: keep the old behaviour rather than go silent.
    expect(shouldSendHeartbeat(undefined)).toBe(true);
  });

  it('a reply that is no longer active refreshes the bar', () => {
    expect(heartbeatEndedActivity('paused')).toBe(true);
    expect(heartbeatEndedActivity('abandoned')).toBe(true);
  });

  it('an active reply, or a reply without a status, changes nothing', () => {
    expect(heartbeatEndedActivity('active')).toBe(false);
    expect(heartbeatEndedActivity(undefined)).toBe(false);
    expect(heartbeatEndedActivity(42)).toBe(false);
  });
});
