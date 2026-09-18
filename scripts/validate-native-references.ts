import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { EXECUTION_LANGUAGES, type ExecutionLanguage } from '@/lib/execution/languages';
import { outputsMatch, wrapUserSource } from '@/server/services/execution/native';
import { loadNativeProblemBatches } from '@/server/services/native-content';
import {
  harnessHash,
  platformTag,
  readReferenceCache,
  referenceCacheKey,
  toolchainVersion,
  writeReferenceCache,
} from './reference-cache';

type Runnable = { command: string; args: string[]; cwd: string };

/**
 * `--no-cache` forces a full run.
 *
 * Worth using periodically, and worth using before trusting a green. A cached
 * pass cannot notice a reference that only passes sometimes — uninitialised
 * memory in C is the real exposure — because the key covers the inputs, not the
 * behaviour. See `scripts/reference-cache.ts`.
 */
const useCache = !process.argv.includes('--no-cache');

/** `<command>` and args used to read each toolchain's version for the cache key. */
const TOOLCHAIN: Record<ExecutionLanguage, [string, string[]]> = {
  c11: ['gcc', ['--version']],
  cpp17: ['g++', ['--version']],
  java: ['javac', ['-version']],
  python3: ['python', ['--version']],
  javascript: ['node', ['--version']],
};

const batches = await loadNativeProblemBatches();
const problems = batches.flatMap((batch) => batch.problems);
const validationRoot = await mkdtemp(join(tmpdir(), 'quadrantcode-reference-validation-'));
const compiled = new Map<string, Runnable>();
let executions = 0;

const previous = useCache ? await readReferenceCache() : new Set<string>();
const verified = new Set<string>();
const harness = await harnessHash();
const platform = platformTag();
const toolchains = Object.fromEntries(
  await Promise.all(
    EXECUTION_LANGUAGES.map(async (language) => {
      const [command, args] = TOOLCHAIN[language];
      return [language, await toolchainVersion(command, args)] as const;
    }),
  ),
) as Record<ExecutionLanguage, string>;

let cacheHits = 0;

try {
  for (const language of EXECUTION_LANGUAGES) {
    for (const problem of problems) {
      const template = problem.languages[language];
      const source = wrapUserSource(template.wrapperTemplate, template.referenceSolution);

      /*
       * Two different caches, and they are not the same thing.
       *
       * `cacheKey` decides whether this record was already PROVEN in a previous
       * run, and skips compiling and executing entirely. `compiled` dedupes
       * compilation WITHIN this run, across records that share a solution.
       */
      const cacheKey = referenceCacheKey({
        language,
        source,
        testCases: problem.testCases,
        toolchain: toolchains[language],
        platform,
        harnessHash: harness,
      });

      if (previous.has(cacheKey)) {
        verified.add(cacheKey);
        cacheHits += 1;
        continue;
      }

      const key = `${language}:${createHash('sha256').update(source).digest('hex')}`;
      let runnable = compiled.get(key);
      if (!runnable) {
        runnable = await prepare(language, source, join(validationRoot, key.replace(':', '-')));
        compiled.set(key, runnable);
      }

      for (const testCase of problem.testCases) {
        const result = await run(runnable, testCase.input, 10_000);
        executions += 1;
        if (result.exitCode !== 0) {
          throw new Error(
            `${problem.slug}/${language}/test-${testCase.coverage} exited ${result.exitCode}: ${result.stderr}`,
          );
        }
        if (!outputsMatch(result.stdout, testCase.expectedOutput)) {
          throw new Error(
            `${problem.slug}/${language}/test-${testCase.coverage} expected ${testCase.expectedOutput}, received ${result.stdout}.`,
          );
        }
      }

      // Recorded only after every test case passed. A partial pass is not a
      // pass, and a throw above means this is never reached.
      verified.add(cacheKey);
    }
    console.log(`validated ${language}: ${problems.length} problems`);
  }

  /*
   * Written only on a clean run. Any failure throws before this point, so a
   * broken record is never recorded as verified and the next run re-proves it.
   */
  if (useCache) await writeReferenceCache(verified);

  const checked = problems.length * EXECUTION_LANGUAGES.length;
  console.log(
    JSON.stringify(
      {
        problems: problems.length,
        languages: EXECUTION_LANGUAGES.length,
        uniqueCompilations: compiled.size,
        executions,
        cached: cacheHits,
        revalidated: checked - cacheHits,
        cache: useCache ? 'on' : 'off (--no-cache)',
        result: 'all reference outputs match',
      },
      null,
      2,
    ),
  );
} finally {
  await rm(validationRoot, { recursive: true, force: true });
}

async function prepare(
  language: ExecutionLanguage,
  source: string,
  directory: string,
): Promise<Runnable> {
  await mkdir(directory, { recursive: true });
  if (language === 'c11') {
    const sourcePath = join(directory, 'main.c');
    const executable = join(directory, 'main.exe');
    await writeFile(sourcePath, source);
    await requireSuccess(
      await run(
        {
          command: 'gcc',
          args: ['-std=c11', '-O2', sourcePath, '-o', executable],
          cwd: directory,
        },
        '',
        30_000,
      ),
      'C11 compilation',
    );
    return { command: executable, args: [], cwd: directory };
  }
  if (language === 'cpp17') {
    const sourcePath = join(directory, 'main.cpp');
    const executable = join(directory, 'main.exe');
    await writeFile(sourcePath, source);
    await requireSuccess(
      await run(
        {
          command: 'g++',
          args: ['-std=c++17', '-O2', sourcePath, '-o', executable],
          cwd: directory,
        },
        '',
        30_000,
      ),
      'C++17 compilation',
    );
    return { command: executable, args: [], cwd: directory };
  }
  if (language === 'java') {
    const sourcePath = join(directory, 'Main.java');
    await writeFile(sourcePath, source);
    await requireSuccess(
      await run({ command: 'javac', args: [sourcePath], cwd: directory }, '', 30_000),
      'Java compilation',
    );
    return { command: 'java', args: ['-cp', directory, 'Main'], cwd: directory };
  }
  if (language === 'python3') {
    const sourcePath = join(directory, 'main.py');
    await writeFile(sourcePath, source);
    await requireSuccess(
      await run(
        { command: 'python', args: ['-m', 'py_compile', sourcePath], cwd: directory },
        '',
        30_000,
      ),
      'Python compilation',
    );
    return { command: 'python', args: [sourcePath], cwd: directory };
  }

  const sourcePath = join(directory, 'main.js');
  await writeFile(sourcePath, source);
  await requireSuccess(
    await run({ command: 'node', args: ['--check', sourcePath], cwd: directory }, '', 30_000),
    'JavaScript compilation',
  );
  return { command: 'node', args: [sourcePath], cwd: directory };
}

async function requireSuccess(
  result: Awaited<ReturnType<typeof run>>,
  operation: string,
): Promise<void> {
  if (result.exitCode !== 0) {
    throw new Error(`${operation} failed: ${result.stderr || result.stdout}`);
  }
}

function run(
  runnable: Runnable,
  input: string,
  timeoutMs: number,
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(runnable.command, runnable.args, {
      cwd: runnable.cwd,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${runnable.command} exceeded ${timeoutMs}ms.`));
    }, timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => (stdout += chunk));
    child.stderr.on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (exitCode) => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? -1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
    child.stdin.end(input);
  });
}
