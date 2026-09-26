/**
 * F4.2 · the tracks, declared in code (D38).
 *
 * A track is an ordered list of sections over problems ALREADY in the catalog,
 * named by slug and resolved at read time. That is why there is no track
 * table: the content is small, reviewed in pull requests like the rest of the
 * code, and the catalog stays the one source of truth for what a problem is.
 * A slug that is not published in the catalog is dropped and counted, never
 * shown as a dead link.
 *
 * ## What is not here, and why
 *
 * The ticket names four tracks. Only Fundamentals ships:
 *
 * - FAANG-, Quant- and HFT-style were **premium** tracks, and premium gating
 *   rests on F4.4's entitlements — F4.4 (billing) is cut, so there is nothing
 *   to gate with and nothing to sell.
 * - HFT-style is built on five ORIGINAL problems authored through F4.1 and
 *   validated on Judge0. They do not exist yet, and a track pointing at
 *   problems that do not exist would be a promise, not a feature.
 *
 * Fundamentals uses the 30 external-link problems published in production on
 * 2026-09-26 (not the ticket's 40: only 30 exist). The `demo-*` rows left by
 * the walkthrough seed are excluded on purpose.
 */

export type TrackSection = {
  id: string;
  title: string;
  /** Section ids that must be complete before this one can be entered. */
  requires: string[];
  slugs: string[];
};

export type Track = {
  slug: string;
  title: string;
  description: string;
  sections: TrackSection[];
};

export const TRACKS: Track[] = [
  {
    slug: 'fundamentals',
    title: 'Fundamentals',
    description:
      'The core patterns, in an order where each section builds on the ones before it.',
    sections: [
      {
        id: 'arrays-hashing',
        title: 'Arrays and hashing',
        requires: [],
        slugs: [
          'two-sum',
          'valid-anagram',
          'best-time-to-buy-and-sell-stock',
          'product-of-array-except-self',
          'maximum-subarray',
          'merge-intervals',
        ],
      },
      {
        id: 'sliding-window',
        title: 'Two pointers and sliding window',
        requires: ['arrays-hashing'],
        slugs: [
          'longest-substring-without-repeating-characters',
          'longest-repeating-character-replacement',
          'permutation-in-string',
          'minimum-window-substring',
        ],
      },
      {
        id: 'stacks-queues',
        title: 'Stacks and queues',
        requires: ['arrays-hashing'],
        slugs: [
          'valid-parentheses',
          'implement-queue-using-stacks',
          'min-stack',
          'daily-temperatures',
          'largest-rectangle-in-histogram',
        ],
      },
      {
        id: 'binary-search',
        title: 'Binary search',
        requires: ['arrays-hashing'],
        slugs: [
          'binary-search',
          'koko-eating-bananas',
          'find-minimum-in-rotated-sorted-array',
          'search-in-rotated-sorted-array',
          'median-of-two-sorted-arrays',
        ],
      },
      {
        id: 'trees',
        title: 'Trees',
        requires: ['stacks-queues'],
        slugs: [
          'invert-binary-tree',
          'maximum-depth-of-binary-tree',
          'binary-tree-level-order-traversal',
          'validate-binary-search-tree',
          'lowest-common-ancestor-of-a-binary-search-tree',
        ],
      },
      {
        id: 'graphs',
        title: 'Graphs',
        requires: ['trees'],
        slugs: [
          'number-of-islands',
          'clone-graph',
          'pacific-atlantic-water-flow',
          'course-schedule',
          'word-ladder',
        ],
      },
    ],
  },
];
