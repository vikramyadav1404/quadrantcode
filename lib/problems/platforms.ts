/**
 * How a stored platform name is shown to people.
 *
 * `problems.platform` holds a lower-case key (`leetcode`, `codeforces`), which
 * is right for filtering and wrong for reading. The known platforms get their
 * own spelling; anything else is shown with its first letter capitalised, so a
 * platform imported from a CSV still reads as a name rather than a key.
 */
const KNOWN: Record<string, string> = {
  atcoder: 'AtCoder',
  codechef: 'CodeChef',
  codeforces: 'Codeforces',
  geeksforgeeks: 'GeeksforGeeks',
  gfg: 'GeeksforGeeks',
  hackerearth: 'HackerEarth',
  hackerrank: 'HackerRank',
  leetcode: 'LeetCode',
  neetcode: 'NeetCode',
  spoj: 'SPOJ',
};

export function platformLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  const known = KNOWN[key];
  if (known) return known;
  const trimmed = platform.trim();
  return trimmed === '' ? trimmed : `${trimmed[0]!.toUpperCase()}${trimmed.slice(1)}`;
}
