/**
 * Topic tags as the catalog presents them.
 *
 * Tags are stored as kebab-case slugs (`dynamic-programming`), which is right
 * for URLs and wrong for headings. This is the one place that turns a slug into
 * a label and decides which topics lead the topic view.
 */

/**
 * The ten patterns the original library is organised by
 * (`NATIVE_TOPIC_DISTRIBUTION`), in the order a learner usually meets them.
 * They lead the topic view, ahead of the far larger external tags, so the
 * curated sequence is the first thing a reader sees rather than the last.
 */
export const PATTERN_ORDER = [
  'arrays-hashing',
  'two-pointers-sliding-window',
  'stack-queue',
  'binary-search',
  'linked-list',
  'trees-bst',
  'heap-greedy',
  'backtracking-trie-bit',
  'graphs',
  'dynamic-programming',
] as const;

const LABELS: Record<string, string> = {
  'arrays-hashing': 'Arrays & Hashing',
  'two-pointers-sliding-window': 'Two Pointers & Sliding Window',
  'stack-queue': 'Stack & Queue',
  'binary-search': 'Binary Search',
  'linked-list': 'Linked List',
  'trees-bst': 'Trees & BST',
  'heap-greedy': 'Heap & Greedy',
  'backtracking-trie-bit': 'Backtracking, Trie & Bits',
  graphs: 'Graphs',
  'dynamic-programming': 'Dynamic Programming',
  dfs: 'DFS',
  '2-sat': '2-SAT',
  fft: 'FFT',
};

/** `two-pointers` → "Two Pointers". Known acronyms and the patterns have fixed labels. */
export function topicLabel(slug: string): string {
  const known = LABELS[slug];
  if (known) return known;
  return slug
    .split('-')
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Patterns first in their fixed order, then every other topic by size, then
 * alphabetically, so the order is total and the page does not reshuffle
 * between two reads with the same counts.
 */
export function compareTopics(
  a: { topic: string; total: number },
  b: { topic: string; total: number },
): number {
  const pa = (PATTERN_ORDER as readonly string[]).indexOf(a.topic);
  const pb = (PATTERN_ORDER as readonly string[]).indexOf(b.topic);
  if (pa !== -1 || pb !== -1) {
    if (pa === -1) return 1;
    if (pb === -1) return -1;
    return pa - pb;
  }
  return b.total - a.total || a.topic.localeCompare(b.topic);
}

/** One problem as the topic view lists it. Shared by the service and the view. */
export type TopicProblem = {
  id: string;
  number: number;
  slug: string;
  title: string;
  difficulty: 'easy' | 'medium' | 'hard';
  sourceType: 'external_link' | 'original';
  platform: string | null;
  userStatus: string | null;
};

export type TopicSection = {
  topic: string;
  total: number;
  easy: number;
  medium: number;
  hard: number;
  /** The first `perTopic` problems, easiest first, then by number. */
  problems: TopicProblem[];
};
