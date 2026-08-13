/**
 * F0.2 seed catalog — 30 external-link problems.
 *
 * CONSTRAINT C1: metadata and a link ONLY. No statement, no examples, no
 * editorial, no test cases. Every row here is title + platform + URL +
 * difficulty + tags, which is exactly what the `problems` CHECK constraint
 * permits for `source_type = 'external_link'`.
 *
 * Difficulty mirrors the platform's own published label. If a URL ever 404s,
 * delete the row — do not guess a replacement slug.
 *
 * Coverage: Arrays · Strings/Sliding Window · Binary Search · Stack/Queue ·
 * Trees · Graphs (5 each).
 */

export type SeedProblem = {
  slug: string;
  title: string;
  platform: string;
  externalUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
  estimatedMinutes: number;
  topics: string[];
  patterns: string[];
};

const lc = (slug: string) => `https://leetcode.com/problems/${slug}/`;

export const SEED_PROBLEMS: SeedProblem[] = [
  // ── Arrays ────────────────────────────────────────────────────────────────
  {
    slug: 'two-sum',
    title: 'Two Sum',
    platform: 'leetcode',
    externalUrl: lc('two-sum'),
    difficulty: 'easy',
    estimatedMinutes: 15,
    topics: ['arrays', 'hashing'],
    patterns: ['hash-map-lookup'],
  },
  {
    slug: 'best-time-to-buy-and-sell-stock',
    title: 'Best Time to Buy and Sell Stock',
    platform: 'leetcode',
    externalUrl: lc('best-time-to-buy-and-sell-stock'),
    difficulty: 'easy',
    estimatedMinutes: 15,
    topics: ['arrays'],
    patterns: ['running-minimum'],
  },
  {
    slug: 'product-of-array-except-self',
    title: 'Product of Array Except Self',
    platform: 'leetcode',
    externalUrl: lc('product-of-array-except-self'),
    difficulty: 'medium',
    estimatedMinutes: 25,
    topics: ['arrays'],
    patterns: ['prefix-suffix-products'],
  },
  {
    slug: 'maximum-subarray',
    title: 'Maximum Subarray',
    platform: 'leetcode',
    externalUrl: lc('maximum-subarray'),
    difficulty: 'medium',
    estimatedMinutes: 20,
    topics: ['arrays', 'dynamic-programming'],
    patterns: ['kadane'],
  },
  {
    slug: 'merge-intervals',
    title: 'Merge Intervals',
    platform: 'leetcode',
    externalUrl: lc('merge-intervals'),
    difficulty: 'medium',
    estimatedMinutes: 25,
    topics: ['arrays', 'sorting'],
    patterns: ['interval-merging'],
  },

  // ── Strings / Sliding Window ─────────────────────────────────────────────
  {
    slug: 'valid-anagram',
    title: 'Valid Anagram',
    platform: 'leetcode',
    externalUrl: lc('valid-anagram'),
    difficulty: 'easy',
    estimatedMinutes: 12,
    topics: ['strings', 'hashing'],
    patterns: ['frequency-count'],
  },
  {
    slug: 'longest-substring-without-repeating-characters',
    title: 'Longest Substring Without Repeating Characters',
    platform: 'leetcode',
    externalUrl: lc('longest-substring-without-repeating-characters'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['strings', 'sliding-window'],
    patterns: ['variable-window'],
  },
  {
    slug: 'longest-repeating-character-replacement',
    title: 'Longest Repeating Character Replacement',
    platform: 'leetcode',
    externalUrl: lc('longest-repeating-character-replacement'),
    difficulty: 'medium',
    estimatedMinutes: 35,
    topics: ['strings', 'sliding-window'],
    patterns: ['variable-window'],
  },
  {
    slug: 'permutation-in-string',
    title: 'Permutation in String',
    platform: 'leetcode',
    externalUrl: lc('permutation-in-string'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['strings', 'sliding-window'],
    patterns: ['fixed-window'],
  },
  {
    slug: 'minimum-window-substring',
    title: 'Minimum Window Substring',
    platform: 'leetcode',
    externalUrl: lc('minimum-window-substring'),
    difficulty: 'hard',
    estimatedMinutes: 45,
    topics: ['strings', 'sliding-window'],
    patterns: ['variable-window'],
  },

  // ── Binary Search ────────────────────────────────────────────────────────
  {
    slug: 'binary-search',
    title: 'Binary Search',
    platform: 'leetcode',
    externalUrl: lc('binary-search'),
    difficulty: 'easy',
    estimatedMinutes: 15,
    topics: ['binary-search'],
    patterns: ['classic-binary-search'],
  },
  {
    slug: 'search-in-rotated-sorted-array',
    title: 'Search in Rotated Sorted Array',
    platform: 'leetcode',
    externalUrl: lc('search-in-rotated-sorted-array'),
    difficulty: 'medium',
    estimatedMinutes: 35,
    topics: ['binary-search', 'arrays'],
    patterns: ['rotated-array-search'],
  },
  {
    slug: 'find-minimum-in-rotated-sorted-array',
    title: 'Find Minimum in Rotated Sorted Array',
    platform: 'leetcode',
    externalUrl: lc('find-minimum-in-rotated-sorted-array'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['binary-search', 'arrays'],
    patterns: ['rotated-array-search'],
  },
  {
    slug: 'koko-eating-bananas',
    title: 'Koko Eating Bananas',
    platform: 'leetcode',
    externalUrl: lc('koko-eating-bananas'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['binary-search'],
    patterns: ['binary-search-on-answer'],
  },
  {
    slug: 'median-of-two-sorted-arrays',
    title: 'Median of Two Sorted Arrays',
    platform: 'leetcode',
    externalUrl: lc('median-of-two-sorted-arrays'),
    difficulty: 'hard',
    estimatedMinutes: 50,
    topics: ['binary-search', 'arrays'],
    patterns: ['partition-search'],
  },

  // ── Stack / Queue ────────────────────────────────────────────────────────
  {
    slug: 'valid-parentheses',
    title: 'Valid Parentheses',
    platform: 'leetcode',
    externalUrl: lc('valid-parentheses'),
    difficulty: 'easy',
    estimatedMinutes: 15,
    topics: ['stack', 'strings'],
    patterns: ['matching-stack'],
  },
  {
    slug: 'implement-queue-using-stacks',
    title: 'Implement Queue using Stacks',
    platform: 'leetcode',
    externalUrl: lc('implement-queue-using-stacks'),
    difficulty: 'easy',
    estimatedMinutes: 20,
    topics: ['stack', 'queue', 'design'],
    patterns: ['amortised-two-stack'],
  },
  {
    slug: 'min-stack',
    title: 'Min Stack',
    platform: 'leetcode',
    externalUrl: lc('min-stack'),
    difficulty: 'medium',
    estimatedMinutes: 25,
    topics: ['stack', 'design'],
    patterns: ['auxiliary-stack'],
  },
  {
    slug: 'daily-temperatures',
    title: 'Daily Temperatures',
    platform: 'leetcode',
    externalUrl: lc('daily-temperatures'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['stack', 'arrays'],
    patterns: ['monotonic-stack'],
  },
  {
    slug: 'largest-rectangle-in-histogram',
    title: 'Largest Rectangle in Histogram',
    platform: 'leetcode',
    externalUrl: lc('largest-rectangle-in-histogram'),
    difficulty: 'hard',
    estimatedMinutes: 50,
    topics: ['stack', 'arrays'],
    patterns: ['monotonic-stack'],
  },

  // ── Trees ────────────────────────────────────────────────────────────────
  {
    slug: 'invert-binary-tree',
    title: 'Invert Binary Tree',
    platform: 'leetcode',
    externalUrl: lc('invert-binary-tree'),
    difficulty: 'easy',
    estimatedMinutes: 12,
    topics: ['trees'],
    patterns: ['tree-recursion'],
  },
  {
    slug: 'maximum-depth-of-binary-tree',
    title: 'Maximum Depth of Binary Tree',
    platform: 'leetcode',
    externalUrl: lc('maximum-depth-of-binary-tree'),
    difficulty: 'easy',
    estimatedMinutes: 12,
    topics: ['trees'],
    patterns: ['tree-recursion'],
  },
  {
    slug: 'binary-tree-level-order-traversal',
    title: 'Binary Tree Level Order Traversal',
    platform: 'leetcode',
    externalUrl: lc('binary-tree-level-order-traversal'),
    difficulty: 'medium',
    estimatedMinutes: 25,
    topics: ['trees', 'queue'],
    patterns: ['bfs'],
  },
  {
    slug: 'validate-binary-search-tree',
    title: 'Validate Binary Search Tree',
    platform: 'leetcode',
    externalUrl: lc('validate-binary-search-tree'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['trees', 'binary-search-tree'],
    patterns: ['bounds-propagation'],
  },
  {
    slug: 'lowest-common-ancestor-of-a-binary-search-tree',
    title: 'Lowest Common Ancestor of a Binary Search Tree',
    platform: 'leetcode',
    externalUrl: lc('lowest-common-ancestor-of-a-binary-search-tree'),
    difficulty: 'medium',
    estimatedMinutes: 25,
    topics: ['trees', 'binary-search-tree'],
    patterns: ['bst-descent'],
  },

  // ── Graphs ───────────────────────────────────────────────────────────────
  {
    slug: 'number-of-islands',
    title: 'Number of Islands',
    platform: 'leetcode',
    externalUrl: lc('number-of-islands'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['graphs', 'matrix'],
    patterns: ['flood-fill'],
  },
  {
    slug: 'clone-graph',
    title: 'Clone Graph',
    platform: 'leetcode',
    externalUrl: lc('clone-graph'),
    difficulty: 'medium',
    estimatedMinutes: 30,
    topics: ['graphs', 'hashing'],
    patterns: ['graph-traversal-with-memo'],
  },
  {
    slug: 'course-schedule',
    title: 'Course Schedule',
    platform: 'leetcode',
    externalUrl: lc('course-schedule'),
    difficulty: 'medium',
    estimatedMinutes: 35,
    topics: ['graphs'],
    patterns: ['topological-sort'],
  },
  {
    slug: 'pacific-atlantic-water-flow',
    title: 'Pacific Atlantic Water Flow',
    platform: 'leetcode',
    externalUrl: lc('pacific-atlantic-water-flow'),
    difficulty: 'medium',
    estimatedMinutes: 40,
    topics: ['graphs', 'matrix'],
    patterns: ['multi-source-traversal'],
  },
  {
    slug: 'word-ladder',
    title: 'Word Ladder',
    platform: 'leetcode',
    externalUrl: lc('word-ladder'),
    difficulty: 'hard',
    estimatedMinutes: 50,
    topics: ['graphs', 'strings'],
    patterns: ['bfs-shortest-path'],
  },
];
