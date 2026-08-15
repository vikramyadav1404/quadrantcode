/**
 * Check whether every curated library URL resolves.
 *
 *   npm run library:verify
 *
 * ## Read this before trusting the output
 *
 * **LeetCode returns 403 to automated requests.** Every row in the current
 * library is a LeetCode URL, so a run today reports every one of them as
 * BLOCKED — not broken, not working, *unknown*. The distinction is the whole
 * point of this script's exit code: a 404 is a defect we introduced, a 403 is a
 * question we are not allowed to ask.
 *
 * That means the acceptance criterion "every row has a working URL" is
 * **UNVERIFIED** for LeetCode, and `docs/acceptance-status.md` says so. What is
 * verified is weaker and worth stating precisely: every URL is *derived* from a
 * slug that matches the canonical pattern (`server/services/ingest/library.ts`),
 * so no row can carry a hand-typed URL with a typo in it. That rules out the
 * failure this script was written to catch; it does not confirm the page exists.
 *
 * **Not fixed by sending a browser User-Agent.** That is evading bot
 * protection to take something the platform is declining to give, which is the
 * behaviour C1 and the ticket's OUT OF SCOPE exist to prevent. A blocked check
 * that says "blocked" is worth more than a green one obtained by pretending.
 *
 * Still useful: it catches a 404 the moment a platform stops blocking, and it
 * works today for any platform that does not block. Run it when the real list
 * arrives.
 *
 * **This is not scraping.** HEAD, or a one-byte ranged GET where HEAD is
 * refused, and only the status code is read. No statement, no editorial, no
 * test data.
 */
import { loadLibrary } from '@/server/services/ingest/library';

const CONCURRENCY = 4;
const TIMEOUT_MS = 15_000;

type Verdict = 'ok' | 'broken' | 'blocked' | 'unreachable';

type Result = { slug: string; url: string; status: number | string; verdict: Verdict };

function classify(status: number | string): Verdict {
  if (typeof status !== 'number') return 'unreachable';
  if (status >= 200 && status < 400) return 'ok';
  // The rows we would have to fix: the page is gone.
  if (status === 404 || status === 410) return 'broken';
  // The platform declined to answer. Says nothing about the URL.
  if (status === 401 || status === 403 || status === 429 || status >= 500) return 'blocked';
  return 'broken';
}

async function check(url: string): Promise<number | string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    });
    if (response.status === 405 || response.status === 501) {
      response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
        redirect: 'follow',
        headers: { range: 'bytes=0-0' },
      });
    }
    return response.status;
  } catch (error) {
    return error instanceof Error ? error.name : 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<void> {
  const library = loadLibrary();
  console.log(`Checking ${library.length} library URLs…\n`);

  const results: Result[] = [];
  const queue = [...library];

  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      for (let next = queue.shift(); next; next = queue.shift()) {
        const status = await check(next.url);
        const verdict = classify(status);
        results.push({ slug: next.slug, url: next.url, status, verdict });
        console.log(
          `  ${verdict.toUpperCase().padEnd(11)} ${String(status).padEnd(8)} ${next.slug}`,
        );
      }
    }),
  );

  const by = (verdict: Verdict) => results.filter((result) => result.verdict === verdict);

  console.log(
    `\nresolved ${by('ok').length} · broken ${by('broken').length} · ` +
      `blocked ${by('blocked').length} · unreachable ${by('unreachable').length}` +
      `  (of ${results.length})`,
  );

  if (by('broken').length > 0) {
    console.error('\nBROKEN — these must be fixed or removed:');
    for (const result of by('broken'))
      console.error(`  ${result.slug} → ${result.url} (${result.status})`);
    process.exitCode = 1;
    return;
  }

  if (by('blocked').length > 0) {
    /*
     * Exit 0, deliberately.
     *
     * "The platform refused to talk to a script" is not a defect in our data,
     * and failing the command would make it indistinguishable from a real
     * broken link — which is the one thing this script exists to identify.
     * It is loud instead.
     */
    console.warn(
      `\nNOT VERIFIED: ${by('blocked').length} URL(s) were blocked by the platform ` +
        `(403/429/5xx).\nThis says nothing about whether they work. See the header ` +
        `of this script, and\ndocs/acceptance-status.md, which records the criterion as UNVERIFIED.`,
    );
  }
}

void main();
