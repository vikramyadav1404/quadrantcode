/**
 * F1.2 · the URL normaliser, as the table test the ticket asks for.
 *
 * Every case is `input → expected output`, because the normaliser is the whole
 * basis of dedup: if two surface forms of one link do not collapse, the user
 * gets a duplicate row and the import is quietly wrong rather than loudly
 * broken.
 *
 * The rejection cases are not padding. Import is the one path where a user
 * supplies URLs in bulk that nobody reads before they are stored and later
 * rendered as `href`s.
 */
import { describe, expect, it } from 'vitest';
import { normaliseProblemUrl } from '@/server/services/ingest/normalise-url';

const LC = 'leetcode.com/problems/two-sum';

describe('F1.2 · normaliseProblemUrl — surface forms of the SAME link', () => {
  it.each([
    ['plain https', 'https://leetcode.com/problems/two-sum', LC],
    ['http instead of https', 'http://leetcode.com/problems/two-sum', LC],
    ['no scheme at all', 'leetcode.com/problems/two-sum', LC],
    ['www.', 'https://www.leetcode.com/problems/two-sum', LC],
    ['trailing slash', 'https://leetcode.com/problems/two-sum/', LC],
    ['several trailing slashes', 'https://leetcode.com/problems/two-sum///', LC],
    ['a query string', 'https://leetcode.com/problems/two-sum/?ref=hn', LC],
    ['a fragment', 'https://leetcode.com/problems/two-sum#discuss', LC],
    ['uppercase host', 'https://LeetCode.com/problems/two-sum', LC],
    ['uppercase slug', 'https://leetcode.com/problems/Two-Sum', LC],
    ['the /description/ tab', 'https://leetcode.com/problems/two-sum/description/', LC],
    ['the /solutions/ tab', 'https://leetcode.com/problems/two-sum/solutions/', LC],
    ['a specific solution', 'https://leetcode.com/problems/two-sum/solutions/12345/x/', LC],
    ['the /submissions/ tab', 'https://leetcode.com/problems/two-sum/submissions/', LC],
    ['surrounding whitespace', '  https://leetcode.com/problems/two-sum  ', LC],
    [
      'everything at once',
      '  HTTP://WWW.LeetCode.com/problems/Two-Sum/description/?ref=x#frag  ',
      LC,
    ],
  ])('%s', (_label, input, expected) => {
    expect(normaliseProblemUrl(input)).toBe(expected);
  });

  it('collapses every one of the above onto a single key', () => {
    // The table above asserts each form individually; this asserts the property
    // the table exists to establish — one key, not sixteen coincidences.
    const forms = [
      'https://leetcode.com/problems/two-sum',
      'http://www.leetcode.com/problems/two-sum/',
      'leetcode.com/problems/Two-Sum/description/?ref=x',
      'https://LEETCODE.com/problems/two-sum#anything',
    ];
    expect(new Set(forms.map(normaliseProblemUrl)).size).toBe(1);
  });
});

describe('F1.2 · normaliseProblemUrl — platform-specific canonical forms', () => {
  it.each([
    [
      'codeforces contest view',
      'https://codeforces.com/contest/1000/problem/A',
      'codeforces.com/problemset/problem/1000/A',
    ],
    [
      'codeforces problemset view',
      'https://codeforces.com/problemset/problem/1000/A',
      'codeforces.com/problemset/problem/1000/A',
    ],
    [
      'codeforces lowercase index is folded up',
      'https://codeforces.com/contest/1000/problem/a',
      'codeforces.com/problemset/problem/1000/A',
    ],
    [
      'hackerrank /problem tab',
      'https://www.hackerrank.com/challenges/simple-array-sum/problem',
      'hackerrank.com/challenges/simple-array-sum',
    ],
    [
      'hackerrank bare challenge',
      'https://hackerrank.com/challenges/simple-array-sum',
      'hackerrank.com/challenges/simple-array-sum',
    ],
    [
      'an unknown host keeps its path verbatim',
      'https://example.org/Some/Case/Sensitive/Path',
      'example.org/Some/Case/Sensitive/Path',
    ],
  ])('%s', (_label, input, expected) => {
    expect(normaliseProblemUrl(input)).toBe(expected);
  });

  it('does NOT merge two different codeforces problems', () => {
    // The positive control for the case-folding decision: if the path were
    // lowercased globally, 1000/A and 1000/B would still differ — but a
    // hypothetical 1000/a would collide with 1000/A. Assert the two real
    // problems stay distinct, and that the letter is the thing distinguishing
    // them.
    const a = normaliseProblemUrl('https://codeforces.com/contest/1000/problem/A');
    const b = normaliseProblemUrl('https://codeforces.com/contest/1000/problem/B');
    expect(a).not.toBe(b);
  });

  it('does not merge two different leetcode problems', () => {
    expect(normaliseProblemUrl('https://leetcode.com/problems/two-sum')).not.toBe(
      normaliseProblemUrl('https://leetcode.com/problems/three-sum'),
    );
  });
});

describe('F1.2 · normaliseProblemUrl — what it REFUSES', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['not a string', 42],
    ['null', null],
    ['undefined', undefined],
    ['a scheme with no host', 'https://'],
  ])('%s → null', (_label, input) => {
    expect(normaliseProblemUrl(input)).toBeNull();
  });

  it.each([
    ['a bare problem slug', 'two-sum'],
    ['a sentence', 'see my list'],
    ['localhost', 'http://localhost:3000/problems/two-sum'],
    ['a bare IP', 'http://192.168.1.1/problems/two-sum'],
    ['a host with no dot', 'https://intranet/problems/two-sum'],
  ])('rejects %s, which the URL parser would accept as a hostname', (_label, input) => {
    /*
     * The gap this closes: prepending https:// to a scheme-less input means
     * `two-sum` parses as a URL whose HOSTNAME is `two-sum`. Without a
     * plausible-host check, a CSV cell containing just a slug would import as a
     * problem hosted at `two-sum` rather than being reported as a bad row.
     *
     * Found by this table, not by reading the code.
     */
    expect(normaliseProblemUrl(input)).toBeNull();
  });

  it('still accepts multi-label and non-com hosts', () => {
    // The positive control for the check above: it must reject implausible
    // hosts without also rejecting real ones.
    expect(normaliseProblemUrl('https://leetcode.cn/problems/two-sum')).toBe(
      'leetcode.cn/problems/two-sum',
    );
    expect(normaliseProblemUrl('https://practice.geeksforgeeks.org/problems/x')).toBe(
      'practice.geeksforgeeks.org/problems/x',
    );
    expect(normaliseProblemUrl('https://example.co.uk/p/1')).toBe('example.co.uk/p/1');
  });

  it.each([
    ['javascript:', 'javascript:alert(1)'],
    ['data:', 'data:text/html,<script>alert(1)</script>'],
    ['file:', 'file:///etc/passwd'],
    ['vbscript:', 'vbscript:msgbox(1)'],
  ])('rejects the %s scheme', (_label, input) => {
    /*
     * These are rejected because an imported URL is rendered as an href. This
     * is the stored-XSS path, and import is where a URL arrives in bulk with
     * nobody reading it.
     */
    expect(normaliseProblemUrl(input)).toBeNull();
  });

  it('rejects a scheme hidden behind a stripped control character', () => {
    /*
     * THE POSITIVE CONTROL for the check-before-parsing ordering.
     *
     * The WHATWG URL parser strips tab, LF and CR from the scheme, so
     * `java\tscript:` PARSES AS `javascript:`. Anything validating the parsed
     * output would see a clean protocol and let it through. This asserts the
     * ordering that makes that impossible — and it is the same trap
     * lib/auth/return-to.ts documents for returnTo.
     *
     * The second assertion proves the trap is real rather than theoretical: if
     * the parser ever stopped stripping, this would fail and the test would be
     * telling us the premise changed.
     */
    expect(normaliseProblemUrl('java\tscript:alert(1)')).toBeNull();
    expect(normaliseProblemUrl('java\nscript:alert(1)')).toBeNull();
    expect(normaliseProblemUrl('java\rscript:alert(1)')).toBeNull();

    // The premise: the parser really does strip these.
    expect(new URL('java\tscript:alert(1)').protocol).toBe('javascript:');
  });

  it('rejects embedded credentials', () => {
    // Would leak if the URL were ever displayed, and is never a real problem
    // link.
    expect(normaliseProblemUrl('https://user:pw@leetcode.com/problems/two-sum')).toBeNull();
  });

  it('rejects a URL containing a raw newline anywhere', () => {
    expect(normaliseProblemUrl('https://leetcode.com/problems/two\nsum')).toBeNull();
  });
});

describe('F1.2 · normaliseProblemUrl — properties', () => {
  const SAMPLES = [
    'https://leetcode.com/problems/two-sum/description/',
    'http://www.codeforces.com/contest/1000/problem/A',
    'https://hackerrank.com/challenges/simple-array-sum/problem',
    'https://example.org/x/y',
  ];

  it('is idempotent — normalising a normalised value changes nothing', () => {
    /*
     * This matters because the stored column is re-derived on every write. If
     * normalise(normalise(x)) !== normalise(x), a row's dedup key would drift
     * on update and the same problem would import twice.
     */
    for (const sample of SAMPLES) {
      const once = normaliseProblemUrl(sample);
      expect(once).not.toBeNull();
      expect(normaliseProblemUrl(once)).toBe(once);
    }
  });

  it('never returns a value carrying a scheme', () => {
    // The output is a dedup key, not a link. A scheme in it would reintroduce
    // the http/https split it exists to remove.
    for (const sample of SAMPLES) {
      expect(normaliseProblemUrl(sample)).not.toMatch(/^[a-z]+:/i);
    }
  });

  it('never returns a trailing slash', () => {
    for (const sample of [...SAMPLES, 'https://example.org/a/b///']) {
      expect(normaliseProblemUrl(sample)).not.toMatch(/\/$/);
    }
  });
});
