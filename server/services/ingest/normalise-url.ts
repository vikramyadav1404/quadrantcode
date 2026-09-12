/**
 * The URL normaliser — the whole basis of import deduplication.
 *
 * A user's CSV and our catalog will disagree about the surface form of the same
 * link in every way a URL can differ: `http` vs `https`, `www.` or not, a
 * trailing slash, a `?ref=` from wherever they copied it, and per-platform
 * suffixes like LeetCode's `/description/`. All of those are the same problem.
 *
 * Pure and exported so it can be table-tested, and so the value stored in
 * `problems.external_url_normalised` is produced by exactly one function.
 *
 * ## Two things this does that the ticket does not ask for
 *
 * **It rejects non-http(s) schemes.** An imported URL is rendered as an `href`.
 * `javascript:alert(1)` reaching that attribute is stored XSS, and import is the
 * one path where a user supplies a URL in bulk without anyone reading it. The
 * ticket says "normalise"; refusing to normalise something that must never be
 * emitted is part of that.
 *
 * **It inspects raw characters BEFORE parsing.** This is the same trap
 * `lib/auth/return-to.ts` documents: the WHATWG URL parser silently strips tab,
 * LF and CR, so `java\tscript:alert(1)` *becomes* `javascript:alert(1)` during
 * parsing. Anything that checks the parsed output has already lost. Checking
 * first is the only order that works.
 */

/**
 * Raw control characters and spaces, rejected before parsing.
 *
 * `\x00-\x20` covers tab/LF/CR and every other C0 control plus the space;
 * `\x7f` is DEL. Leading and trailing whitespace is trimmed first, because a
 * CSV cell routinely carries it and that is not the user getting it wrong.
 */
const FORBIDDEN_RAW = /[\x00-\x20\x7f]/;

/** The only schemes a problem link may use. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * A hostname with a real-looking public suffix.
 *
 * Needed because of how the scheme-less convenience below interacts with the
 * URL parser: `two-sum` becomes `https://two-sum`, which parses perfectly well
 * as a URL whose *hostname* is `two-sum`. Without this, a CSV cell containing
 * just a problem slug would import as a problem hosted at `two-sum` rather than
 * being reported as a bad row — found by the table test, not by review.
 *
 * Requires a dot and an alphabetic final label, so `leetcode.com` and
 * `example.co.uk` pass while `two-sum`, `localhost` and `192.168.1.1` do not.
 * None of the latter are legitimate homes for a public problem link.
 */
const PLAUSIBLE_HOST = /^(?:[a-z0-9-]+\.)+[a-z]{2,}$/;

/**
 * Per-platform canonicalisation.
 *
 * `lowercasePath` is opt-in per platform rather than global: LeetCode and
 * HackerRank slugs are lowercase by construction, so folding case there is
 * safe and makes `/Problems/Two-Sum` deduplicate. Codeforces problem indices
 * are uppercase letters (`.../problem/A`) and folding them would merge distinct
 * problems, so unknown and case-sensitive hosts keep their path verbatim.
 */
type PlatformRule = {
  readonly hosts: readonly string[];
  readonly lowercasePath: boolean;
  readonly canonicalise?: (pathname: string) => string;
};

const PLATFORM_RULES: readonly PlatformRule[] = [
  {
    hosts: ['leetcode.com', 'leetcode.cn'],
    lowercasePath: true,
    /*
     * Everything under a problem is the same problem: `/description/` is the
     * default tab, and `/solutions/`, `/submissions/`, `/editorial/` are all
     * reached by clicking around inside it. Users paste whichever tab they
     * happened to be on.
     */
    canonicalise: (pathname) => {
      const match = /^\/problems\/([^/]+)/.exec(pathname);
      return match ? `/problems/${match[1]}` : pathname;
    },
  },
  {
    hosts: ['hackerrank.com'],
    lowercasePath: true,
    // `/challenges/<slug>/problem` is the statement tab of `/challenges/<slug>`.
    canonicalise: (pathname) => pathname.replace(/^(\/challenges\/[^/]+)\/problem$/, '$1'),
  },
  {
    hosts: ['codeforces.com'],
    // Problem indices are uppercase letters; folding case would merge 1000/A
    // and a hypothetical 1000/a into one row.
    lowercasePath: false,
    /*
     * The same problem has two official URLs — the contest view and the
     * problemset view. Neither redirects to the other, so both are in the wild:
     *   /contest/1000/problem/A  ==  /problemset/problem/1000/A
     * Collapsed onto the problemset form.
     */
    canonicalise: (pathname) => {
      const match = /^\/contest\/(\d+)\/problem\/([A-Za-z]\d*)$/.exec(pathname);
      return match ? `/problemset/problem/${match[1]}/${match[2]!.toUpperCase()}` : pathname;
    },
  },
];

function ruleFor(host: string): PlatformRule | undefined {
  return PLATFORM_RULES.find((rule) => rule.hosts.includes(host));
}

/**
 * Normalise a problem URL to its deduplication key, or `null` if it is not a
 * usable problem link.
 *
 * The returned value has **no scheme** — that is deliberate, and it is what
 * makes `http://` and `https://` collapse onto one key. It is a dedup key, not
 * a link; the original `external_url` is what gets rendered.
 *
 * @example
 * normaliseProblemUrl('https://www.leetcode.com/problems/Two-Sum/description/?ref=x')
 * // → 'leetcode.com/problems/two-sum'
 */
export function normaliseProblemUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;

  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  // BEFORE parsing. See the header — the parser would strip these for us and
  // hand back something that looks clean.
  if (FORBIDDEN_RAW.test(trimmed)) return null;

  /*
   * Users paste `leetcode.com/problems/two-sum` without a scheme constantly.
   * Only assume https for something that already looks like a bare host — if a
   * scheme is present it must stand on its own merits below, so this cannot be
   * used to smuggle `javascript:` past the protocol check.
   */
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ? trimmed : `https://${trimmed}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (!ALLOWED_PROTOCOLS.has(url.protocol)) return null;

  // Credentials in a problem link are never legitimate and would leak if the
  // URL were ever displayed.
  if (url.username !== '' || url.password !== '') return null;

  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (!PLAUSIBLE_HOST.test(host)) return null;

  const rule = ruleFor(host);

  let pathname = rule?.lowercasePath ? url.pathname.toLowerCase() : url.pathname;
  pathname = rule?.canonicalise?.(pathname) ?? pathname;

  // Trailing slash last, so a rule can match `/challenges/x/problem` without
  // also having to spell the slash variant.
  pathname = pathname.replace(/\/+$/, '');

  /*
   * Query and fragment are dropped, per the ticket. Safe for every platform in
   * PLATFORM_RULES, whose problem identity lives entirely in the path. A
   * platform that identifies a problem by query parameter would need a rule
   * here that preserves the parameters it cares about — hence the per-platform
   * table rather than one global strip.
   *
   * The port is kept when non-default: a different port is a different origin,
   * and silently merging them would be wrong even though it is unlikely here.
   */
  const port = url.port === '' ? '' : `:${url.port}`;

  return `${host}${port}${pathname}`;
}
