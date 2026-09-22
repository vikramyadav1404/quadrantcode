/**
 * Resolve every execution language against the LIVE Judge0 instance, and fail
 * if what it finds disagrees with what the app claims.
 *
 * ## Why this exists
 *
 * `EXECUTION_RUNTIME_LABELS` is shown to users next to the language picker, and
 * `JUDGE0_PINNED_LANGUAGE_IDS` decides which compiler their code is actually
 * sent to. Both are constants. A constant describing a remote system is a claim
 * that rots silently — the label still says "GCC 9.2.0" long after the instance
 * stopped offering id 50, and nothing fails.
 *
 * So this is a CHECK, not a report: it exits non-zero on drift, the same way
 * `npm run contrast` does rather than leaving a note in a file.
 *
 * It also prints every candidate per language with its id, which is what you
 * need in order to choose a pin — the reason the Clang-over-GCC selection bug
 * was found at all.
 *
 * ## Running it
 *
 *   JUDGE0_URL=https://… JUDGE0_API_KEY=… npm run judge0:languages
 *
 * Not in CI: it needs a token and a reachable instance, neither of which CI
 * has. Run it after provisioning or upgrading Judge0.
 */
import 'dotenv/config';
import { EXECUTION_LANGUAGES, EXECUTION_RUNTIME_LABELS } from '@/lib/execution/languages';
import {
  JUDGE0_LANGUAGE_MATCHERS,
  JUDGE0_PINNED_LANGUAGE_IDS,
  type Judge0Language,
  selectJudge0Language,
} from '@/server/services/execution/judge0';

const baseUrl = process.env.JUDGE0_URL;
const apiKey = process.env.JUDGE0_API_KEY;

if (!baseUrl) {
  console.error('JUDGE0_URL must be set.');
  process.exit(2);
}

const response = await fetch(`${baseUrl}/languages`, {
  headers: {
    'content-type': 'application/json',
    ...(apiKey ? { 'X-Auth-Token': apiKey } : {}),
  },
});

if (!response.ok) {
  // 401 here is the single most likely failure, and it is worth naming: the
  // provider fetches this same endpoint to discover ids, so a bad token breaks
  // every execution before any user code runs.
  console.error(
    `GET ${baseUrl}/languages -> HTTP ${response.status}` +
      (response.status === 401 ? ' (JUDGE0_API_KEY missing or stale)' : ''),
  );
  process.exit(2);
}

const catalogue = (await response.json()) as Judge0Language[];
const active = catalogue.filter((language) => !language.is_archived);
console.log(`instance exposes ${active.length} active languages\n`);

const problems: string[] = [];

for (const language of EXECUTION_LANGUAGES) {
  const matcher = JUDGE0_LANGUAGE_MATCHERS[language];
  const candidates = active
    .filter((entry) => matcher.test(entry.name))
    .sort((left, right) => right.id - left.id);

  const pinned = JUDGE0_PINNED_LANGUAGE_IDS[language];
  const resolved =
    pinned === undefined
      ? selectJudge0Language(active, language)
      : (active.find((entry) => entry.id === pinned) ?? null);

  console.log(`${language}${pinned === undefined ? '' : `  (pinned to id ${pinned})`}`);
  for (const candidate of candidates) {
    const mark = resolved && candidate.id === resolved.id ? '  <== resolved' : '';
    console.log(`   id ${String(candidate.id).padEnd(4)} ${candidate.name}${mark}`);
  }
  if (candidates.length === 0) console.log('   (no candidates)');

  if (!resolved) {
    problems.push(
      pinned === undefined
        ? `${language}: instance exposes no runtime matching ${matcher}`
        : `${language}: pinned id ${pinned} is not offered by this instance`,
    );
    console.log('');
    continue;
  }

  /*
   * The label is compared as a substring of the instance's name with its
   * PARENTHESES REMOVED, not for equality.
   *
   * Judge0 writes "C (GCC 9.2.0)" and "Python (3.8.1)"; the UI wants "GCC
   * 9.2.0" and "Python 3.8.1". Equality would force Judge0's formatting into
   * the interface, and a raw substring test fails on exactly the case where
   * the label reads naturally — "Python 3.8.1" is not inside "Python (3.8.1)".
   * Dropping the brackets makes both forms comparable without either one
   * having to adopt the other's punctuation.
   *
   * (This check found that on its first run against a real instance, which is
   * the argument for it being a check rather than a comment.)
   */
  const normalise = (value: string) => value.replace(/[()]/g, ' ').replace(/\s+/g, ' ').trim();
  const claimed = EXECUTION_RUNTIME_LABELS[language];
  if (!normalise(resolved.name).includes(normalise(claimed))) {
    problems.push(
      `${language}: label says "${claimed}" but the instance resolves to "${resolved.name}"`,
    );
  }

  // A pin that resolves to something the matcher would reject is a sign the
  // pin was copied from another instance's catalogue.
  if (pinned !== undefined && !matcher.test(resolved.name)) {
    problems.push(
      `${language}: pinned id ${pinned} is "${resolved.name}", which does not match ${matcher}`,
    );
  }

  console.log('');
}

if (problems.length > 0) {
  console.error('DRIFT — the app and the instance disagree:');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error('\nUpdate EXECUTION_RUNTIME_LABELS / JUDGE0_PINNED_LANGUAGE_IDS to match.');
  process.exit(1);
}

console.log('OK — every language resolves, and every label matches the instance.');
