import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  nativeProblemBatchSchema,
  validateNativeLibrary,
} from '@/server/services/native-content/schema';

type AlgorithmKey =
  | 'max-frequency'
  | 'pair-target-count'
  | 'lower-bound'
  | 'largest-rectangle'
  | 'kth-from-end'
  | 'tree-depth'
  | 'minimum-merge-cost'
  | 'graph-components'
  | 'subset-target-count'
  | 'house-robber';

type Case = {
  values: number[];
  coverage:
    | 'sample'
    | 'empty'
    | 'minimum'
    | 'maximum'
    | 'duplicates'
    | 'adversarial'
    | 'performance'
    | 'typical';
};

type Algorithm = {
  titleConcept: string;
  inputFormat: string;
  outputFormat: string;
  constraints: string[];
  hints: string[];
  overview: string;
  brute: string;
  optimal: string;
  proof: string;
  time: string;
  space: string;
  solve: (values: number[]) => number;
  cases: Case[];
};

const TOPIC_TITLES: Record<string, string[]> = {
  'arrays-hashing': [
    'Signal Frequency Ledger',
    'Archive Duplicate Pulse',
    'Warehouse Mode Counter',
    'Telemetry Majority Meter',
    'Parcel Repeat Index',
    'Beacon Crowd Measure',
    'Workshop Frequency Peak',
    'Survey Answer Concentration',
    'Sensor Echo Counter',
    'Notebook Symbol Density',
    'Transit Tap Popularity',
    'Cache Key Hotspot',
    'Festival Badge Frequency',
    'Library Borrowing Peak',
    'Network Code Concentration',
  ],
  'two-pointers-sliding-window': [
    'Twin Gate Target Pairs',
    'Harbor Weight Pairing',
    'Budget Match Counter',
    'Workshop Rod Pairing',
    'Courier Load Complements',
    'Museum Ticket Pair Count',
    'Solar Panel Pair Balance',
    'Recipe Measure Partners',
    'Bridge Cable Pairing',
    'Inventory Complement Scan',
  ],
  'binary-search': [
    'Sorted Dock Insertion',
    'Archive Shelf Position',
    'Calibration Threshold Slot',
    'Transit Schedule Insertion',
    'Signal Strength Boundary',
    'Warehouse Rank Gateway',
    'Library Call Number Slot',
    'Production Limit Position',
  ],
  'stack-queue': [
    'Skyline Banner Area',
    'Warehouse Stack Footprint',
    'Histogram Signal Block',
    'Festival Stall Rectangle',
    'Server Load Plateau',
    'Terrain Profile Rectangle',
    'Factory Bar Span',
    'Rain Gauge Rectangle',
  ],
  'linked-list': [
    'Courier Chain Tail Lookup',
    'Relay Node From Finish',
    'Carriage Tail Offset',
    'Playlist Reverse Position',
    'Pipeline Segment From End',
    'Badge Chain Tail Query',
    'Checkpoint Reverse Rank',
  ],
  'trees-bst': [
    'Orchard Canopy Depth',
    'Folder Hierarchy Height',
    'Decision Tree Levels',
    'Family Archive Depth',
    'Network Relay Tree Height',
    'Museum Wing Hierarchy',
    'Botanical Branch Depth',
    'Organization Layer Count',
    'Game Map Tree Levels',
    'Supply Route Hierarchy',
    'Filesystem Nested Depth',
    'Signal Tower Tree Height',
  ],
  'heap-greedy': [
    'Fiber Bundle Merge Cost',
    'Parcel Consolidation Cost',
    'Data Shard Merge Budget',
    'Rope Workshop Minimum Cost',
    'Stream Segment Merge Cost',
    'Document Batch Merge',
    'Cargo Grouping Budget',
    'Audio Track Merge Cost',
  ],
  graphs: [
    'Island Network Groups',
    'Research Team Components',
    'Transit Zone Clusters',
    'Device Mesh Components',
    'Friend Circle Counter',
    'Warehouse Link Groups',
    'Pipeline Network Regions',
    'Constellation Connection Groups',
    'Server Fleet Clusters',
    'Trail Map Components',
    'Workshop Collaboration Groups',
    'Beacon Network Regions',
  ],
  'backtracking-trie-bit': [
    'Donation Target Subsets',
    'Recipe Measure Combinations',
    'Battery Pack Target Sets',
    'Research Sample Selections',
    'Festival Token Subsets',
    'Cargo Weight Combination Count',
    'Study Hour Target Sets',
    'Sensor Group Target Count',
  ],
  'dynamic-programming': [
    'Nonadjacent Vault Yield',
    'Street Donation Planner',
    'Server Maintenance Reward',
    'Orchard Harvest Without Neighbors',
    'Gallery Security Collection',
    'Workshop Shift Reward',
    'Solar Field Selection',
    'Courier Stop Value Plan',
    'Festival Stall Profit',
    'Archive Shelf Reward',
    'Research Grant Selection',
    'Transit Station Value Plan',
  ],
};

const TOPIC_ALGORITHM: Record<string, AlgorithmKey> = {
  'arrays-hashing': 'max-frequency',
  'two-pointers-sliding-window': 'pair-target-count',
  'binary-search': 'lower-bound',
  'stack-queue': 'largest-rectangle',
  'linked-list': 'kth-from-end',
  'trees-bst': 'tree-depth',
  'heap-greedy': 'minimum-merge-cost',
  graphs: 'graph-components',
  'backtracking-trie-bit': 'subset-target-count',
  'dynamic-programming': 'house-robber',
};

const COMPANIES = [
  'amazon',
  'google',
  'microsoft',
  'meta',
  'adobe',
  'flipkart',
  'atlassian',
  'uber',
  'goldman-sachs',
  'walmart',
];

const ALGORITHMS: Record<AlgorithmKey, Algorithm> = {
  'max-frequency': {
    titleConcept: 'maximum frequency',
    inputFormat: 'The function receives all integer observations as one array named values.',
    outputFormat:
      'Return the largest number of occurrences of any one integer; return 0 for an empty array.',
    constraints: [
      '0 <= values.length <= 200000',
      '-1000000000 <= values[i] <= 1000000000',
      'Equal values represent the same observation.',
    ],
    hints: [
      'Record how often each distinct value has appeared.',
      'The answer changes only when one stored count exceeds the current maximum.',
    ],
    overview:
      'Maintain a frequency table while scanning the observations once, and retain the largest count reached.',
    brute:
      'For every position, scan the full array and count equal values, then take the largest count.',
    optimal:
      'Use a hash table from value to count. Increment one entry for each observation and update a running maximum.',
    proof:
      'After processing any prefix, the table stores the exact count of every value in that prefix. The running maximum is therefore the greatest prefix count. After the full array it is exactly the requested maximum frequency.',
    time: 'O(n) expected',
    space: 'O(n)',
    solve: (v) => {
      const m = new Map<number, number>();
      let best = 0;
      for (const x of v) {
        const n = (m.get(x) ?? 0) + 1;
        m.set(x, n);
        best = Math.max(best, n);
      }
      return best;
    },
    cases: cases([
      [4, 4, 2, 4],
      [],
      [9],
      [2, 2, 3, 3],
      Array.from({ length: 120 }, (_, i) => i % 7),
      [-1, -1, 0, -1, 0],
    ]),
  },
  'pair-target-count': {
    titleConcept: 'distinct target pairs',
    inputFormat: 'values[0] is the target. The remaining elements form the collection to pair.',
    outputFormat:
      'Return the number of distinct unordered value pairs whose sum equals the target.',
    constraints: [
      '1 <= values.length <= 200001',
      '-1000000000 <= every integer <= 1000000000',
      'A pair uses two different positions; equal-value pairs need two copies.',
    ],
    hints: [
      'Sort the collection and place one pointer at each end.',
      'Move both pointers after a match and skip repeated values so a value pair is counted once.',
    ],
    overview:
      'Sort the payload values, then converge two pointers according to whether their sum is below, above, or equal to the target.',
    brute:
      'Try every pair of positions and store matching value pairs in a set to remove duplicates.',
    optimal:
      'A sorted two-pointer scan counts each distinct complement pair once while skipping equal neighbors.',
    proof:
      'At each step, a sum below target cannot be repaired by decreasing the right value, so advancing left loses no solution; the symmetric argument holds above target. A match is counted once and duplicate values are skipped, so every distinct pair appears exactly once.',
    time: 'O(n log n)',
    space: 'O(n) for a sorted copy',
    solve: pairCount,
    cases: cases([
      [7, 1, 6, 2, 5, 3, 4],
      [5, 1, 4, 2, 3],
      [0],
      [4, 2, 2, 2, 2],
      [20, ...Array.from({ length: 100 }, (_, i) => i)],
      [0, -3, 3, -2, 2, 0, 0],
    ]),
  },
  'lower-bound': {
    titleConcept: 'first valid sorted position',
    inputFormat:
      'values[0] is the query target. values[1..] is a nondecreasing sorted sequence.',
    outputFormat:
      'Return the zero-based position inside the sorted sequence where target first could appear.',
    constraints: [
      '1 <= values.length <= 200001',
      'values[1..] is sorted in nondecreasing order',
      'The answer may equal the sequence length.',
    ],
    hints: [
      'Maintain a half-open search interval [low, high).',
      'When the middle value is at least the target, keep the middle position in the candidate interval.',
    ],
    overview:
      'Binary search for the first element that is not smaller than the target, using the sequence after the first input cell.',
    brute: 'Scan from the beginning until an element is at least the target.',
    optimal:
      'Repeatedly halve a half-open interval. Move high to mid when the middle is large enough; otherwise move low past mid.',
    proof:
      'All indices below low are known smaller than target and every valid answer remains below high. Each update preserves these invariants and shrinks the interval. At low = high, that index is the first possible insertion position.',
    time: 'O(log n)',
    space: 'O(1)',
    solve: lowerBound,
    cases: cases([
      [5, 1, 3, 5, 5, 8],
      [4, 1, 3, 5, 7],
      [9],
      [2, 2, 2, 2],
      [199, ...Array.from({ length: 200 }, (_, i) => i * 2)],
      [-5, -4, -3, 0, 9],
    ]),
  },
  'largest-rectangle': {
    titleConcept: 'largest contiguous rectangle',
    inputFormat: 'The array values contains nonnegative bar heights in left-to-right order.',
    outputFormat: 'Return the greatest rectangular area supported by consecutive bars.',
    constraints: [
      '0 <= values.length <= 200000',
      '0 <= values[i] <= 1000000000',
      'The result fits in a signed 64-bit integer.',
    ],
    hints: [
      'A bar can extend until the first smaller bar on each side.',
      'Use a monotonic increasing stack and finalize taller bars when a shorter bar arrives.',
    ],
    overview:
      'Use a monotonic stack of starting positions and heights. Each pop finalizes the widest rectangle for that height.',
    brute:
      'Choose every left boundary, extend right, maintain the minimum height, and evaluate each rectangle.',
    optimal:
      'Keep increasing heights with their earliest valid starts. A lower height closes all taller rectangles; a zero sentinel closes the rest.',
    proof:
      'A popped height cannot extend through the current lower bar, and its stored start is the earliest position it can reach. Thus the computed width is maximal for that height. Every height is eventually popped, so the best rectangle is considered.',
    time: 'O(n)',
    space: 'O(n)',
    solve: largestRectangle,
    cases: cases([
      [2, 1, 5, 6, 2, 3],
      [2, 4],
      [],
      [3, 3, 3],
      Array.from({ length: 150 }, (_, i) => (i % 11) + 1),
      [5, 4, 3, 2, 1],
    ]),
  },
  'kth-from-end': {
    titleConcept: 'reverse-rank chain lookup',
    inputFormat:
      'values[0] is k (one means the tail). values[1..] lists linked-list node values from head to tail.',
    outputFormat:
      'Return the value of the kth node from the end, or -1 when k is outside the chain.',
    constraints: [
      '1 <= values.length <= 200001',
      '1 <= k <= 1000000000',
      'Node values fit in signed 32-bit integers.',
    ],
    hints: [
      'Move a lead pointer k nodes before moving a second pointer.',
      'When the lead pointer reaches the end, the second pointer has the requested reverse rank.',
    ],
    overview:
      'Interpret the payload after k as a singly linked chain and keep a fixed gap between two positions.',
    brute: 'Count all nodes, convert the reverse rank to a forward index, then traverse again.',
    optimal:
      'Advance a lead position k steps. If possible, advance lead and follower together until lead leaves the chain.',
    proof:
      'The lead stays exactly k nodes ahead of the follower. When lead is one position beyond the tail, exactly k nodes including the follower remain from follower to tail, so follower is kth from the end.',
    time: 'O(n)',
    space: 'O(1)',
    solve: (v) =>
      v.length > 1 && v[0]! >= 1 && v[0]! <= v.length - 1 ? v[v.length - v[0]!]! : -1,
    cases: cases([
      [2, 10, 20, 30, 40],
      [1, 7, 8],
      [1, 9],
      [3, 5, 5, 5],
      [100, ...Array.from({ length: 150 }, (_, i) => i)],
      [9, 1, 2],
    ]),
  },
  'tree-depth': {
    titleConcept: 'binary-tree depth',
    inputFormat:
      'values is a level-order binary-tree array using -1 for a missing node. Children of index i are 2i+1 and 2i+2.',
    outputFormat:
      'Return the number of nodes on the longest root-to-present-node path; an empty or missing root has depth 0.',
    constraints: [
      '0 <= values.length <= 200000',
      '-1 marks absence and is not a node value',
      'Every present non-root node has a present ancestor chain.',
    ],
    hints: [
      'A level-order index determines its tree level.',
      'Scan present nodes and retain the largest level, or traverse breadth first.',
    ],
    overview:
      'Visit each present level-order entry and determine its one-based depth from its heap index.',
    brute: 'For each present node, repeatedly move to its parent and count steps to the root.',
    optimal:
      'Scan indices once while tracking the next power-of-two level boundary, updating the maximum for present nodes.',
    proof:
      'Heap indices [2^(d-1)-1, 2^d-2] are exactly depth d. Every present node is inspected and assigned its exact depth, so the maximum assigned depth equals the longest root-to-node path.',
    time: 'O(n)',
    space: 'O(1)',
    solve: treeDepth,
    cases: cases([
      [1, 2, 3, 4, -1, -1, 7],
      [5],
      [],
      [1, 2, 2, 3, 3, 3, 3],
      [1, ...Array.from({ length: 126 }, (_, i) => i + 2)],
      [-1, 2, 3],
    ]),
  },
  'minimum-merge-cost': {
    titleConcept: 'minimum repeated merge cost',
    inputFormat:
      'values contains nonnegative bundle sizes. A merge replaces two bundles by their sum and charges that sum.',
    outputFormat: 'Return the minimum total charge needed to leave at most one bundle.',
    constraints: [
      '0 <= values.length <= 200000',
      '0 <= values[i] <= 1000000000',
      'The total cost fits in signed 64-bit range.',
    ],
    hints: [
      'An expensive combined bundle may be charged again later.',
      'Always combine the two smallest current bundles; a min-heap makes them available.',
    ],
    overview:
      'Use the optimal merge pattern: repeatedly remove the two smallest sizes, add their sum to the cost, and insert the sum.',
    brute:
      'Explore every possible pair to merge at every stage and take the cheapest complete sequence.',
    optimal:
      'A min-heap implements the greedy choice of merging the two smallest current bundles.',
    proof:
      'In an optimal merge tree, the two smallest weights can be made sibling leaves at greatest depth without increasing cost. Merging them reduces the problem to the same problem on one fewer bundle, so repeating the choice is optimal.',
    time: 'O(n log n)',
    space: 'O(n)',
    solve: mergeCost,
    cases: cases([
      [4, 3, 2, 6],
      [5, 5],
      [],
      [1, 1, 1, 1],
      Array.from({ length: 100 }, (_, i) => (i % 13) + 1),
      [0, 0, 9],
    ]),
  },
  'graph-components': {
    titleConcept: 'undirected connected components',
    inputFormat:
      'values[0] is node count n. Remaining values are endpoint pairs for undirected edges over nodes 0..n-1.',
    outputFormat: 'Return the number of connected components, counting isolated nodes.',
    constraints: [
      '1 <= n <= 200000',
      'The remaining input length is even',
      '0 <= each edge endpoint < n; duplicate edges and self-loops may occur.',
    ],
    hints: [
      'Begin with every node in its own group.',
      'Union the endpoints of each edge and count how many roots remain.',
    ],
    overview:
      'A disjoint-set union structure starts with n components and merges the roots of every edge.',
    brute: 'For each unvisited node, run a graph traversal and mark every reachable node.',
    optimal:
      'Union by representative with path compression; decrement the component count only when two roots differ.',
    proof:
      'Initially each isolated node is one component. An edge between different representatives merges exactly two components and reduces the count by one; an edge inside one representative changes nothing. After all edges, representatives match graph connectivity.',
    time: 'O((n + m) α(n))',
    space: 'O(n)',
    solve: components,
    cases: cases([
      [5, 0, 1, 1, 2, 3, 4],
      [3, 0, 1, 1, 2],
      [1],
      [4, 0, 1, 0, 1, 2, 2],
      [
        120,
        ...Array.from({ length: 238 }, (_, i) => (i % 2 === 0 ? i / 2 : i / 2 + 0.5)).map(
          Math.floor,
        ),
      ],
      [4, 0, 0, 2, 3],
    ]),
  },
  'subset-target-count': {
    titleConcept: 'target-sum subset count',
    inputFormat:
      'values[0] is a nonnegative target. Remaining nonnegative integers may each be selected at most once.',
    outputFormat: 'Return the number of index-distinct subsets whose sum is exactly target.',
    constraints: [
      '1 <= values.length <= 45',
      '0 <= target <= 10000',
      '0 <= candidate value <= target; the answer fits signed 64-bit range.',
    ],
    hints: [
      'Track how many selections produce each sum up to the target.',
      'Update sums from high to low so one candidate is not reused in the same step.',
    ],
    overview:
      'One-dimensional subset-sum dynamic programming counts index-distinct selections for every reachable sum.',
    brute: 'Enumerate all 2^n subsets, compute each sum, and count those equal to target.',
    optimal:
      'Set ways[0] = 1. For each candidate, add ways[sum-value] into ways[sum] while iterating sums downward.',
    proof:
      'Before a candidate, ways[s] counts subsets of earlier candidates totaling s. Downward updates add exactly the subsets formed by appending the current candidate, while retaining subsets that omit it. Thus the invariant holds after every candidate.',
    time: 'O(n × target)',
    space: 'O(target)',
    solve: subsetCount,
    cases: cases([
      [5, 1, 2, 3, 4],
      [0, 1, 2],
      [1],
      [4, 2, 2, 2],
      [30, ...Array.from({ length: 24 }, (_, i) => (i % 7) + 1)],
      [3, 0, 0, 3],
    ]),
  },
  'house-robber': {
    titleConcept: 'maximum nonadjacent total',
    inputFormat: 'values contains nonnegative rewards in their fixed left-to-right order.',
    outputFormat:
      'Return the maximum total reward obtainable without selecting adjacent positions.',
    constraints: [
      '0 <= values.length <= 200000',
      '0 <= values[i] <= 1000000000',
      'The result fits in signed 64-bit range.',
    ],
    hints: [
      'At each position, compare skipping it with taking it after the best result two positions back.',
      'Only the previous two dynamic-programming states are needed.',
    ],
    overview:
      'Use the recurrence best[i] = max(best[i-1], best[i-2] + values[i]) with two rolling variables.',
    brute:
      'Recursively choose or skip every position, rejecting branches that choose adjacent positions.',
    optimal:
      'Maintain the best total through the previous position and through the position before it, updating once per reward.',
    proof:
      'Every valid optimal selection either omits the current position, giving the previous best, or includes it, forcing omission of the previous position and giving the two-back best plus current reward. Taking the maximum covers both exhaustive cases.',
    time: 'O(n)',
    space: 'O(1)',
    solve: robber,
    cases: cases([
      [2, 7, 9, 3, 1],
      [1, 2, 3, 1],
      [],
      [5, 5, 5, 5],
      Array.from({ length: 160 }, (_, i) => (i % 17) + 1),
      [0, 100, 0, 100, 0],
    ]),
  },
};

const REFERENCE: Record<
  AlgorithmKey,
  Record<'c11' | 'cpp17' | 'java' | 'python3' | 'javascript', string>
> = buildReferences();

const difficultyPattern = Array.from({ length: 100 }, (_, index) => {
  const slot = index % 5;
  const cycle = Math.floor(index / 5);
  if (slot === 3) return 'hard' as const;
  if (cycle < 5) return slot === 0 ? ('easy' as const) : ('medium' as const);
  return slot === 0 || slot === 2 ? ('easy' as const) : ('medium' as const);
});

const descriptors = Object.entries(TOPIC_TITLES).flatMap(([topic, titles]) =>
  titles.map((title) => ({ topic, title, algorithm: TOPIC_ALGORITHM[topic]! })),
);
if (descriptors.length !== 100)
  throw new Error(`Expected 100 descriptors, found ${descriptors.length}.`);

const problems = descriptors.map((descriptor, index) => makeProblem(descriptor, index));
const batches = [];
await mkdir('data/native-problems', { recursive: true });
for (let index = 0; index < 10; index += 1) {
  const parsed = nativeProblemBatchSchema.parse({
    schemaVersion: 1,
    batch: index + 1,
    reviewStatus: 'needs_review',
    problems: problems.slice(index * 10, index * 10 + 10),
  });
  await writeFile(
    join('data/native-problems', `batch-${String(index + 1).padStart(2, '0')}.json`),
    `${JSON.stringify(parsed, null, 2)}\n`,
  );
  batches.push(parsed);
  console.log(`validated batch ${index + 1}: ${parsed.problems.length} problems`);
}
console.log(JSON.stringify(validateNativeLibrary(batches), null, 2));

function makeProblem(
  descriptor: { topic: string; title: string; algorithm: AlgorithmKey },
  index: number,
) {
  const algorithm = ALGORITHMS[descriptor.algorithm];
  const difficulty = difficultyPattern[index]!;
  const difficultyOrdinal = difficultyPattern
    .slice(0, index)
    .filter((value) => value === difficulty).length;
  const slug = descriptor.title
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  const testCases = algorithm.cases.map((test, testIndex) => ({
    visibility: testIndex === 0 ? 'sample' : testIndex === 1 ? 'visible' : 'hidden',
    input: test.values.join(' '),
    expectedOutput: String(algorithm.solve(test.values)),
    explanation:
      testIndex < 2
        ? `Applying the ${algorithm.titleConcept} rule to this input produces the stated result without using any unstated data.`
        : undefined,
    coverage: test.coverage,
    isPerformance: test.coverage === 'maximum' || test.coverage === 'performance',
  }));
  const languageTemplates = templatesFor(descriptor.algorithm);
  return {
    slug,
    title: descriptor.title,
    difficulty,
    primaryTopic: descriptor.topic,
    topics: [descriptor.topic, descriptor.algorithm],
    problemType: 'function',
    version: 1,
    status: 'needs_review',
    estimatedMinutes: difficulty === 'easy' ? 20 : difficulty === 'medium' ? 35 : 55,
    difficultyCalibration: 0,
    story: `${descriptor.title} is an independent Quadrantcode practice scenario. A planning team has reduced its observations to an integer sequence and needs a precise ${algorithm.titleConcept} result before the next decision can be made.`,
    statement: `Implement the required function for ${descriptor.title}. Interpret the supplied sequence exactly as described in the input contract, compute the ${algorithm.titleConcept}, and return only the requested integer. The function must handle boundary cases and the largest stated input without modifying any external state.`,
    inputFormat: algorithm.inputFormat,
    outputFormat: algorithm.outputFormat,
    functionContract: {
      functionName: 'solve',
      parameters: [
        {
          name: 'values',
          type: 'integer[]',
          description: 'The complete integer encoding described by this problem.',
        },
      ],
      returnType: '64-bit integer',
    },
    constraints: algorithm.constraints,
    examples: testCases.slice(0, 2).map((test, exampleIndex) => ({
      input: test.input,
      output: test.expectedOutput,
      explanation: `Example ${exampleIndex + 1} follows the stated ${algorithm.titleConcept} process. Every contributing value is visible in the input, and the computed result is ${test.expectedOutput}.`,
    })),
    testCases,
    timeLimitMs: difficulty === 'hard' ? 2_000 : 1_500,
    memoryLimitKb: 128_000,
    hints: algorithm.hints,
    editorial: {
      overview: algorithm.overview,
      bruteForceApproach: algorithm.brute,
      optimalApproach: algorithm.optimal,
      correctnessProof: algorithm.proof,
      timeComplexity: algorithm.time,
      spaceComplexity: algorithm.space,
    },
    languages: languageTemplates,
    provenance: {
      contentSource: 'quadrantcode-original',
      independentlyCreated: true,
      licenseName: 'Quadrantcode Original Practice Content License',
      licenseUrl: null,
      author: 'Quadrantcode editorial team',
      note: 'Independently authored for Quadrantcode; no third-party statement, example, editorial, solution, or test was copied.',
    },
    companies: [0, 5].map((offset) => ({
      companySlug: COMPANIES[(difficultyOrdinal + offset) % COMPANIES.length],
      evidenceType: 'company_pattern',
      role: null,
      round: null,
      candidateLevel: null,
      yearFrom: null,
      yearTo: null,
      location: null,
      sourceUrl: null,
      reportCount: 0,
      confidenceScore: 0,
      verificationStatus: 'unverified',
      lastReviewedDate: null,
    })),
  };
}

function templatesFor(key: AlgorithmKey) {
  const refs = REFERENCE[key];
  const serialization = {
    input: 'Whitespace-separated signed integers read into values.',
    output: 'One signed integer.',
    equality: 'exact_json' as const,
  };
  return {
    c11: {
      displayName: 'C',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long solve(const long long *values, int n)',
      starterCode:
        'long long solve(const long long *values, int n) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <stdio.h>\n#include <stdlib.h>\n#include <string.h>\n/*__USER_CODE__*/\nint main(void){int n=0,cap=16; long long *a=malloc(sizeof(long long)*cap),x; while(scanf("%lld",&x)==1){if(n==cap){cap*=2;a=realloc(a,sizeof(long long)*cap);}a[n++]=x;} printf("%lld",solve(a,n)); free(a); return 0;}',
      serialization,
      referenceSolution: refs.c11,
    },
    cpp17: {
      displayName: 'C++',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'long long solve(const vector<long long>& values)',
      starterCode:
        'long long solve(const vector<long long>& values) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        '#include <bits/stdc++.h>\nusing namespace std;\n/*__USER_CODE__*/\nint main(){ios::sync_with_stdio(false);cin.tie(nullptr);vector<long long>a;long long x;while(cin>>x)a.push_back(x);cout<<solve(a);}',
      serialization,
      referenceSolution: refs.cpp17,
    },
    java: {
      displayName: 'Java',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'static long solve(long[] values)',
      starterCode:
        'static long solve(long[] values) {\n  // Write your solution here.\n  return 0L;\n}',
      wrapperTemplate:
        'import java.io.*;\nimport java.util.*;\npublic class Main {\n/*__USER_CODE__*/\npublic static void main(String[] args)throws Exception{String s=new String(System.in.readAllBytes()).trim();if(s.isEmpty()){System.out.print(solve(new long[0]));return;}String[]p=s.split("\\\\s+");long[]a=new long[p.length];for(int i=0;i<p.length;i++)a[i]=Long.parseLong(p[i]);System.out.print(solve(a));}\n}',
      serialization,
      referenceSolution: refs.java,
    },
    python3: {
      displayName: 'Python',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'def solve(values: list[int]) -> int',
      starterCode:
        'def solve(values: list[int]) -> int:\n    # Write your solution here.\n    return 0',
      wrapperTemplate:
        '/*__USER_CODE__*/\nif __name__ == "__main__":\n    import sys\n    values = [int(x) for x in sys.stdin.read().split()]\n    print(solve(values))',
      serialization,
      referenceSolution: refs.python3,
    },
    javascript: {
      displayName: 'JavaScript',
      runtimeVersion: null,
      judge0LanguageId: null,
      functionSignature: 'function solve(values)',
      starterCode: 'function solve(values) {\n  // Write your solution here.\n  return 0;\n}',
      wrapperTemplate:
        'const fs = require("fs");\n/*__USER_CODE__*/\nconst raw=fs.readFileSync(0,"utf8").trim();const values=raw?raw.split(/\\s+/).map(Number):[];console.log(String(solve(values)));',
      serialization,
      referenceSolution: refs.javascript,
    },
  };
}

function cases(values: number[][]): Case[] {
  const coverage: Case['coverage'][] = [
    'sample',
    'typical',
    'minimum',
    'duplicates',
    'maximum',
    'adversarial',
  ];
  return values.map((entry, index) => ({ values: entry, coverage: coverage[index]! }));
}

function pairCount(v: number[]) {
  const t = v[0] ?? 0,
    a = v.slice(1).sort((x, y) => x - y);
  let l = 0,
    r = a.length - 1,
    c = 0;
  while (l < r) {
    const s = a[l]! + a[r]!;
    if (s === t) {
      c++;
      const x = a[l],
        y = a[r];
      while (l < r && a[l] === x) l++;
      while (l < r && a[r] === y) r--;
    } else if (s < t) l++;
    else r--;
  }
  return c;
}
function lowerBound(v: number[]) {
  const t = v[0] ?? 0,
    a = v.slice(1);
  let l = 0,
    r = a.length;
  while (l < r) {
    const m = (l + r) >> 1;
    if (a[m]! >= t) r = m;
    else l = m + 1;
  }
  return l;
}
function largestRectangle(v: number[]) {
  const st: { s: number; h: number }[] = [];
  let best = 0;
  for (let i = 0; i <= v.length; i++) {
    const h = i < v.length ? v[i]! : 0;
    let s = i;
    while (st.length && st.at(-1)!.h > h) {
      const p = st.pop()!;
      best = Math.max(best, p.h * (i - p.s));
      s = p.s;
    }
    if (!st.length || st.at(-1)!.h < h) st.push({ s, h });
  }
  return best;
}
function treeDepth(v: number[]) {
  let best = 0,
    next = 1,
    d = 1;
  if (!v.length || v[0] === -1) return 0;
  for (let i = 0; i < v.length; i++) {
    if (i === next) {
      d++;
      next = next * 2 + 1;
    }
    if (v[i] !== -1) best = Math.max(best, d);
  }
  return best;
}
function mergeCost(v: number[]) {
  const a = [...v];
  let cost = 0;
  while (a.length > 1) {
    a.sort((x, y) => x - y);
    const s = a.shift()! + a.shift()!;
    cost += s;
    a.push(s);
  }
  return cost;
}
function components(v: number[]) {
  const n = v[0] ?? 0,
    p = Array.from({ length: n }, (_, i) => i);
  const f = (x: number): number => (p[x] === x ? x : (p[x] = f(p[x]!)));
  let c = n;
  for (let i = 1; i + 1 < v.length; i += 2) {
    const a = f(v[i]!),
      b = f(v[i + 1]!);
    if (a !== b) {
      p[a] = b;
      c--;
    }
  }
  return c;
}
function subsetCount(v: number[]) {
  const t = v[0] ?? 0,
    dp = Array(t + 1).fill(0);
  dp[0] = 1;
  for (const x of v.slice(1)) for (let s = t; s >= x; s--) dp[s] += dp[s - x];
  return dp[t];
}
function robber(v: number[]) {
  let a = 0,
    b = 0;
  for (const x of v) {
    const n = Math.max(b, a + x);
    a = b;
    b = n;
  }
  return b;
}

function buildReferences() {
  const common = {
    'max-frequency': {
      c11: 'int cmp_ll(const void*a,const void*b){long long x=*(const long long*)a,y=*(const long long*)b;return x>y?1:x<y?-1:0;}\nlong long solve(const long long*v,int n){if(!n)return 0;long long*a=malloc(sizeof(long long)*n);memcpy(a,v,sizeof(long long)*n);qsort(a,n,sizeof(long long),cmp_ll);long long best=1,run=1;for(int i=1;i<n;i++){run=a[i]==a[i-1]?run+1:1;if(run>best)best=run;}free(a);return best;}',
      cpp17:
        'long long solve(const vector<long long>&v){unordered_map<long long,long long>f;long long best=0;for(auto x:v)best=max(best,++f[x]);return best;}',
      java: 'static long solve(long[]v){Map<Long,Long>f=new HashMap<>();long best=0;for(long x:v){long n=f.getOrDefault(x,0L)+1;f.put(x,n);best=Math.max(best,n);}return best;}',
      python3:
        'def solve(values: list[int]) -> int:\n    from collections import Counter\n    return max(Counter(values).values(), default=0)',
      javascript:
        'function solve(v){const f=new Map();let b=0;for(const x of v){const n=(f.get(x)||0)+1;f.set(x,n);b=Math.max(b,n);}return b;}',
    },
    'pair-target-count': {
      c11: 'int cmp_ll(const void*a,const void*b){long long x=*(const long long*)a,y=*(const long long*)b;return x>y?1:x<y?-1:0;}\nlong long solve(const long long*v,int n){if(n<3)return 0;long long*a=malloc(sizeof(long long)*(n-1));memcpy(a,v+1,sizeof(long long)*(n-1));qsort(a,n-1,sizeof(long long),cmp_ll);int l=0,r=n-2;long long c=0;while(l<r){long long s=a[l]+a[r];if(s==v[0]){c++;long long x=a[l],y=a[r];while(l<r&&a[l]==x)l++;while(l<r&&a[r]==y)r--;}else if(s<v[0])l++;else r--;}free(a);return c;}',
      cpp17:
        'long long solve(const vector<long long>&v){if(v.empty())return 0;auto a=vector<long long>(v.begin()+1,v.end());sort(a.begin(),a.end());int l=0,r=(int)a.size()-1;long long c=0;while(l<r){auto s=a[l]+a[r];if(s==v[0]){c++;auto x=a[l],y=a[r];while(l<r&&a[l]==x)l++;while(l<r&&a[r]==y)r--;}else if(s<v[0])l++;else r--;}return c;}',
      java: 'static long solve(long[]v){if(v.length==0)return 0;long[]a=Arrays.copyOfRange(v,1,v.length);Arrays.sort(a);int l=0,r=a.length-1;long c=0;while(l<r){long s=a[l]+a[r];if(s==v[0]){c++;long x=a[l],y=a[r];while(l<r&&a[l]==x)l++;while(l<r&&a[r]==y)r--;}else if(s<v[0])l++;else r--;}return c;}',
      python3:
        'def solve(v: list[int]) -> int:\n    if not v: return 0\n    t,a=v[0],sorted(v[1:]);l,r,c=0,len(a)-1,0\n    while l<r:\n        s=a[l]+a[r]\n        if s==t:\n            c+=1;x,y=a[l],a[r]\n            while l<r and a[l]==x:l+=1\n            while l<r and a[r]==y:r-=1\n        elif s<t:l+=1\n        else:r-=1\n    return c',
      javascript:
        'function solve(v){if(!v.length)return 0;const t=v[0],a=v.slice(1).sort((x,y)=>x-y);let l=0,r=a.length-1,c=0;while(l<r){const s=a[l]+a[r];if(s===t){c++;const x=a[l],y=a[r];while(l<r&&a[l]===x)l++;while(l<r&&a[r]===y)r--;}else if(s<t)l++;else r--;}return c;}',
    },
    'lower-bound': {
      c11: 'long long solve(const long long*v,int n){if(!n)return 0;int l=1,r=n;while(l<r){int m=l+(r-l)/2;if(v[m]>=v[0])r=m;else l=m+1;}return l-1;}',
      cpp17:
        'long long solve(const vector<long long>&v){if(v.empty())return 0;return lower_bound(v.begin()+1,v.end(),v[0])-(v.begin()+1);}',
      java: 'static long solve(long[]v){if(v.length==0)return 0;int l=1,r=v.length;while(l<r){int m=(l+r)>>>1;if(v[m]>=v[0])r=m;else l=m+1;}return l-1;}',
      python3:
        'def solve(v: list[int]) -> int:\n    if not v:return 0\n    import bisect\n    return bisect.bisect_left(v[1:],v[0])',
      javascript:
        'function solve(v){if(!v.length)return 0;let l=1,r=v.length;while(l<r){const m=(l+r)>>1;if(v[m]>=v[0])r=m;else l=m+1;}return l-1;}',
    },
    'largest-rectangle': {
      c11: 'long long solve(const long long*v,int n){long long best=0,*h=malloc(sizeof(long long)*(n+1));int*s=malloc(sizeof(int)*(n+1)),top=0;for(int i=0;i<=n;i++){long long x=i<n?v[i]:0;int start=i;while(top&&h[top-1]>x){top--;if(h[top]*(i-s[top])>best)best=h[top]*(i-s[top]);start=s[top];}if(!top||h[top-1]<x){h[top]=x;s[top++]=start;}}free(h);free(s);return best;}',
      cpp17:
        'long long solve(const vector<long long>&v){vector<pair<int,long long>>st;long long b=0;for(int i=0;i<=(int)v.size();i++){long long h=i<(int)v.size()?v[i]:0;int s=i;while(!st.empty()&&st.back().second>h){auto p=st.back();st.pop_back();b=max(b,p.second*(i-p.first));s=p.first;}if(st.empty()||st.back().second<h)st.push_back({s,h});}return b;}',
      java: 'static long solve(long[]v){int n=v.length,top=0;long[]h=new long[n+1];int[]s=new int[n+1];long best=0;for(int i=0;i<=n;i++){long x=i<n?v[i]:0;int start=i;while(top>0&&h[top-1]>x){top--;best=Math.max(best,h[top]*(i-s[top]));start=s[top];}if(top==0||h[top-1]<x){h[top]=x;s[top++]=start;}}return best;}',
      python3:
        'def solve(v: list[int]) -> int:\n    st=[];best=0\n    for i,h in enumerate(v+[0]):\n        start=i\n        while st and st[-1][1]>h:\n            s,x=st.pop();best=max(best,x*(i-s));start=s\n        if not st or st[-1][1]<h:st.append((start,h))\n    return best',
      javascript:
        'function solve(v){const st=[];let b=0;for(let i=0;i<=v.length;i++){const h=i<v.length?v[i]:0;let s=i;while(st.length&&st.at(-1)[1]>h){const p=st.pop();b=Math.max(b,p[1]*(i-p[0]));s=p[0];}if(!st.length||st.at(-1)[1]<h)st.push([s,h]);}return b;}',
    },
    'kth-from-end': {
      c11: 'long long solve(const long long*v,int n){if(n<2||v[0]<1||v[0]>n-1)return -1;return v[n-(int)v[0]];}',
      cpp17:
        'long long solve(const vector<long long>&v){return v.size()>1&&v[0]>=1&&v[0]<(long long)v.size()?v[v.size()-v[0]]:-1;}',
      java: 'static long solve(long[]v){return v.length>1&&v[0]>=1&&v[0]<v.length?v[v.length-(int)v[0]]:-1;}',
      python3:
        'def solve(v: list[int]) -> int:\n    return v[-v[0]] if len(v)>1 and 1<=v[0]<len(v) else -1',
      javascript:
        'function solve(v){return v.length>1&&v[0]>=1&&v[0]<v.length?v[v.length-v[0]]:-1;}',
    },
    'tree-depth': {
      c11: 'long long solve(const long long*v,int n){if(!n||v[0]==-1)return 0;int d=1,next=1,b=0;for(int i=0;i<n;i++){if(i==next){d++;next=next*2+1;}if(v[i]!=-1&&d>b)b=d;}return b;}',
      cpp17:
        'long long solve(const vector<long long>&v){if(v.empty()||v[0]==-1)return 0;int d=1,next=1,b=0;for(int i=0;i<(int)v.size();i++){if(i==next){d++;next=next*2+1;}if(v[i]!=-1)b=max(b,d);}return b;}',
      java: 'static long solve(long[]v){if(v.length==0||v[0]==-1)return 0;int d=1,next=1,b=0;for(int i=0;i<v.length;i++){if(i==next){d++;next=next*2+1;}if(v[i]!=-1)b=Math.max(b,d);}return b;}',
      python3:
        'def solve(v: list[int]) -> int:\n    if not v or v[0]==-1:return 0\n    d,nxt,b=1,1,0\n    for i,x in enumerate(v):\n        if i==nxt:d+=1;nxt=nxt*2+1\n        if x!=-1:b=max(b,d)\n    return b',
      javascript:
        'function solve(v){if(!v.length||v[0]===-1)return 0;let d=1,n=1,b=0;for(let i=0;i<v.length;i++){if(i===n){d++;n=n*2+1;}if(v[i]!==-1)b=Math.max(b,d);}return b;}',
    },
    'minimum-merge-cost': {
      c11: 'int cmp_ll(const void*a,const void*b){long long x=*(const long long*)a,y=*(const long long*)b;return x>y?1:x<y?-1:0;}\nlong long solve(const long long*v,int n){long long*a=malloc(sizeof(long long)*(n?n:1));memcpy(a,v,sizeof(long long)*n);long long c=0;while(n>1){qsort(a,n,sizeof(long long),cmp_ll);long long s=a[0]+a[1];c+=s;memmove(a,a+2,sizeof(long long)*(n-2));a[n-2]=s;n--;}free(a);return c;}',
      cpp17:
        'long long solve(const vector<long long>&v){priority_queue<long long,vector<long long>,greater<long long>>q(v.begin(),v.end());long long c=0;while(q.size()>1){auto a=q.top();q.pop();auto b=q.top();q.pop();c+=a+b;q.push(a+b);}return c;}',
      java: 'static long solve(long[]v){PriorityQueue<Long>q=new PriorityQueue<>();for(long x:v)q.add(x);long c=0;while(q.size()>1){long s=q.remove()+q.remove();c+=s;q.add(s);}return c;}',
      python3:
        'def solve(v: list[int]) -> int:\n    import heapq\n    q=v[:];heapq.heapify(q);c=0\n    while len(q)>1:\n        s=heapq.heappop(q)+heapq.heappop(q);c+=s;heapq.heappush(q,s)\n    return c',
      javascript:
        'function solve(v){const a=v.slice();let c=0;while(a.length>1){a.sort((x,y)=>x-y);const s=a.shift()+a.shift();c+=s;a.push(s);}return c;}',
    },
    'graph-components': {
      c11: 'int root(int*p,int x){while(p[x]!=x){p[x]=p[p[x]];x=p[x];}return x;}\nlong long solve(const long long*v,int z){if(!z)return 0;int n=(int)v[0],*p=malloc(sizeof(int)*n);for(int i=0;i<n;i++)p[i]=i;int c=n;for(int i=1;i+1<z;i+=2){int a=root(p,(int)v[i]),b=root(p,(int)v[i+1]);if(a!=b){p[a]=b;c--;}}free(p);return c;}',
      cpp17:
        'long long solve(const vector<long long>&v){if(v.empty())return 0;int n=v[0];vector<int>p(n);iota(p.begin(),p.end(),0);function<int(int)>f=[&](int x){return p[x]==x?x:p[x]=f(p[x]);};int c=n;for(int i=1;i+1<(int)v.size();i+=2){int a=f(v[i]),b=f(v[i+1]);if(a!=b)p[a]=b,c--;}return c;}',
      java: 'static int root(int[]p,int x){while(p[x]!=x){p[x]=p[p[x]];x=p[x];}return x;}static long solve(long[]v){if(v.length==0)return 0;int n=(int)v[0],c=n;int[]p=new int[n];for(int i=0;i<n;i++)p[i]=i;for(int i=1;i+1<v.length;i+=2){int a=root(p,(int)v[i]),b=root(p,(int)v[i+1]);if(a!=b){p[a]=b;c--;}}return c;}',
      python3:
        'def solve(v: list[int]) -> int:\n    if not v:return 0\n    n=v[0];p=list(range(n))\n    def f(x):\n        while p[x]!=x:p[x]=p[p[x]];x=p[x]\n        return x\n    c=n\n    for i in range(1,len(v)-1,2):\n        a,b=f(v[i]),f(v[i+1])\n        if a!=b:p[a]=b;c-=1\n    return c',
      javascript:
        'function solve(v){if(!v.length)return 0;const n=v[0],p=Array.from({length:n},(_,i)=>i);function f(x){while(p[x]!==x){p[x]=p[p[x]];x=p[x];}return x;}let c=n;for(let i=1;i+1<v.length;i+=2){const a=f(v[i]),b=f(v[i+1]);if(a!==b){p[a]=b;c--;}}return c;}',
    },
    'subset-target-count': {
      c11: 'long long solve(const long long*v,int n){if(!n)return 0;int t=v[0];long long*d=calloc(t+1,sizeof(long long));d[0]=1;for(int i=1;i<n;i++)for(int s=t;s>=v[i];s--)d[s]+=d[s-v[i]];long long a=d[t];free(d);return a;}',
      cpp17:
        'long long solve(const vector<long long>&v){if(v.empty())return 0;int t=v[0];vector<long long>d(t+1);d[0]=1;for(int i=1;i<(int)v.size();i++)for(int s=t;s>=v[i];s--)d[s]+=d[s-v[i]];return d[t];}',
      java: 'static long solve(long[]v){if(v.length==0)return 0;int t=(int)v[0];long[]d=new long[t+1];d[0]=1;for(int i=1;i<v.length;i++)for(int s=t;s>=v[i];s--)d[s]+=d[s-(int)v[i]];return d[t];}',
      python3:
        'def solve(v: list[int]) -> int:\n    if not v:return 0\n    t=v[0];d=[0]*(t+1);d[0]=1\n    for x in v[1:]:\n        for s in range(t,x-1,-1):d[s]+=d[s-x]\n    return d[t]',
      javascript:
        'function solve(v){if(!v.length)return 0;const t=v[0],d=Array(t+1).fill(0);d[0]=1;for(const x of v.slice(1))for(let s=t;s>=x;s--)d[s]+=d[s-x];return d[t];}',
    },
    'house-robber': {
      c11: 'long long solve(const long long*v,int n){long long a=0,b=0;for(int i=0;i<n;i++){long long z=b>a+v[i]?b:a+v[i];a=b;b=z;}return b;}',
      cpp17:
        'long long solve(const vector<long long>&v){long long a=0,b=0;for(auto x:v){auto n=max(b,a+x);a=b;b=n;}return b;}',
      java: 'static long solve(long[]v){long a=0,b=0;for(long x:v){long n=Math.max(b,a+x);a=b;b=n;}return b;}',
      python3:
        'def solve(v: list[int]) -> int:\n    a=b=0\n    for x in v:a,b=b,max(b,a+x)\n    return b',
      javascript:
        'function solve(v){let a=0,b=0;for(const x of v){const n=Math.max(b,a+x);a=b;b=n;}return b;}',
    },
  };
  return common as Record<
    AlgorithmKey,
    Record<'c11' | 'cpp17' | 'java' | 'python3' | 'javascript', string>
  >;
}
