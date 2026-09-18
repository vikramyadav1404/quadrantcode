/**
 * Cache of reference-validation results, so an unchanged record is not
 * recompiled and re-run on every pass.
 *
 * ## Why
 *
 * `validate-native-references.ts` compiles and runs every reference solution in
 * five languages against every test case. At a hundred problems that is about
 * seven minutes. Measured per language on this machine — 13.7 ms per execution
 * for C, 25.7 for C++, 164.7 for Java, 269.3 for Python, 76.3 for JavaScript,
 * and about five seconds to compile one solution across all five — a library of
 * a few thousand problems projects to roughly **7.9 hours per run**, sequential.
 * Nearly all of it is re-proving records that have not changed since the last
 * pass.
 *
 * ## What the key covers, and why each part is there
 *
 * A cached pass is only trustworthy if nothing underneath it can change without
 * the key noticing:
 *
 * | component     | catches                                                    |
 * | ------------- | ---------------------------------------------------------- |
 * | `source`      | a changed reference solution, or the wrapper it splices into |
 * | `testCases`   | an edited input or expected output, or a new case             |
 * | `toolchain`   | gcc, javac, python or node upgraded                           |
 * | `platform`    | a cache built on Windows reused on Linux                      |
 * | `harnessHash` | `wrapUserSource` or `outputsMatch` changing                   |
 *
 * `harnessHash` is the subtle one. Those two functions are shared by every
 * record, so a change to either invalidates every cached result while nothing
 * per-record would notice. The alternative was a hand-bumped constant, which
 * relies on someone remembering; hashing the file is automatic, and
 * over-invalidating on an unrelated edit to that file is the safe direction.
 *
 * ## What the key CANNOT cover
 *
 * **Nondeterminism.** A reference that passes by luck — uninitialised memory in
 * C is the real exposure — caches green and stays green. Today every run
 * re-rolls that dice; caching removes that accidental safety net. The same goes
 * for a solution creeping towards the time limit: the cached pass hides the
 * drift.
 *
 * No key fixes this. Run `npm run native:validate-references -- --no-cache`
 * periodically, and treat a cached green as weaker evidence than an uncached
 * one.
 *
 * The cache is a local file under `.tmp/`, which is gitignored. It is never
 * committed, deliberately: a cache in the repository would be a claim that
 * anyone could forge, and CI does not run this script anyway — see
 * `docs/status.md`.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { spawn } from 'node:child_process';

export const REFERENCE_CACHE_PATH = '.tmp/reference-validation-cache.json';

/** Bumped only if the cache FILE format changes; the key handles everything else. */
const CACHE_SCHEMA = 1;

export type ReferenceCacheKeyInput = {
  language: string;
  source: string;
  testCases: readonly { input: string; expectedOutput: string }[];
  toolchain: string;
  platform: string;
  harnessHash: string;
};

/**
 * A stable key for one (record, language) validation result.
 *
 * Serialised as a structured array rather than concatenated with a separator.
 * Concatenation invites a forged boundary: with `language + ':' + source`, the
 * pairs ('c11:x', '') and ('c11', 'x') would collide. JSON gives each field its
 * own quoted span.
 */
export function referenceCacheKey(input: ReferenceCacheKeyInput): string {
  const canonical = JSON.stringify([
    CACHE_SCHEMA,
    input.language,
    input.source,
    input.testCases.map((test) => [test.input, test.expectedOutput]),
    input.toolchain,
    input.platform,
    input.harnessHash,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

/** The current platform, as a cache component. */
export function platformTag(): string {
  return `${process.platform}-${process.arch}`;
}

/**
 * sha256 of the module holding `wrapUserSource` and `outputsMatch`.
 *
 * Read from disk rather than imported, because what matters is the source text
 * that produced the cached results, not the runtime value.
 */
export async function harnessHash(
  path = 'server/services/execution/native.ts',
): Promise<string> {
  return createHash('sha256')
    .update(await readFile(path, 'utf8'))
    .digest('hex');
}

/**
 * `<command> --version`, trimmed to one line.
 *
 * A failure to read a version is NOT swallowed into a constant: that would key
 * every result to the same string and hide a toolchain change. It throws, and
 * the caller decides.
 */
export function toolchainVersion(command: string, args = ['--version']): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.once('error', reject);
    child.once('close', (code) => {
      const first = output.split('\n')[0]?.trim() ?? '';
      if (code !== 0 && first === '') {
        reject(new Error(`Could not read a version from ${command}.`));
        return;
      }
      resolve(first);
    });
  });
}

type CacheFile = { schema: number; entries: Record<string, string> };

/**
 * Load the cache, or an empty one.
 *
 * Any problem — missing file, unreadable JSON, a schema from a different
 * version — yields an empty cache rather than an error. A cache is an
 * optimisation, and failing a validation run because an optimisation could not
 * be read would be the wrong trade. The cost of being wrong here is a slow run,
 * not a false pass.
 */
export async function readReferenceCache(path = REFERENCE_CACHE_PATH): Promise<Set<string>> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    const file = parsed as CacheFile;
    if (file?.schema !== CACHE_SCHEMA || typeof file.entries !== 'object') return new Set();
    return new Set(Object.keys(file.entries));
  } catch {
    return new Set();
  }
}

/** Write the cache, creating `.tmp/` if this is the first run. */
export async function writeReferenceCache(
  keys: ReadonlySet<string>,
  path = REFERENCE_CACHE_PATH,
): Promise<void> {
  const stamp = new Date().toISOString();
  const entries: Record<string, string> = {};
  for (const key of keys) entries[key] = stamp;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ schema: CACHE_SCHEMA, entries }, null, 0) + '\n');
}
