import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const provider = readFileSync('server/services/execution/sandbox.ts', 'utf8');
const supervisor = readFileSync('sandbox/runner/quadrant-exec.c', 'utf8');
const dockerfile = readFileSync('sandbox/Dockerfile', 'utf8');

describe('execution Sandbox defence in depth', () => {
  it('denies egress and sends no inherited environment or port', () => {
    expect(provider).toContain("networkPolicy: 'deny-all'");
    expect(provider).toContain('persistent: false');
    expect(provider).toContain('ports: []');
    expect(provider).toContain('env: {}');
    expect(provider).not.toContain('...process.env');
  });

  it('uses namespaces, cgroups and an unprivileged execution identity', () => {
    expect(supervisor).toContain('CLONE_NEWNET');
    expect(supervisor).toContain('CLONE_NEWPID');
    expect(supervisor).toContain('memory.max');
    expect(supervisor).toContain('pids.max');
    expect(supervisor).toContain('setuid(context->uid)');
    expect(supervisor).toContain('clearenv()');
    expect(dockerfile).toContain('USER quadrant:quadrant');
  });

  it('opens and unlinks the one test input before dropping privileges', () => {
    expect(supervisor).toMatch(/open\(config\.stdin_path,[\s\S]+unlink\(config\.stdin_path\)/);
    expect(supervisor).toContain('setuid(context->uid)');
  });
});
