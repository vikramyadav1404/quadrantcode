/**
 * Runs a problem's own JavaScript reference solution in-process, on one input.
 *
 * Only OUR code runs here — the reviewed reference inside the problem's own
 * wrapper — never a user's; user code only ever runs on the execution
 * provider. The input is integers we generated. `node:vm` with a timeout keeps
 * a slow reference from holding the request, and the sandbox gets nothing but
 * a `require('fs')` whose `readFileSync` returns the input and a `console.log`
 * that captures the output.
 */
import { runInNewContext } from 'node:vm';
import { wrapUserSource } from '@/server/services/execution/native';

export class ReferenceRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReferenceRunError';
  }
}

export function runReference(
  input: { wrapperTemplate: string; referenceSolution: string; stdin: string },
  timeoutMs = 1_000,
): string {
  const source = wrapUserSource(input.wrapperTemplate, input.referenceSolution, 'javascript');
  const lines: string[] = [];
  const fakeFs = { readFileSync: () => input.stdin };
  const sandbox = {
    require: (name: string) => {
      if (name === 'fs') return fakeFs;
      throw new ReferenceRunError(`The reference may not load ${name}.`);
    },
    console: { log: (...parts: unknown[]) => lines.push(parts.map(String).join(' ')) },
  };
  try {
    runInNewContext(source, sandbox, { timeout: timeoutMs });
  } catch (error) {
    throw new ReferenceRunError(
      `The reference failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return lines.join('\n');
}
