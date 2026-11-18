/**
 * Small random inputs for every original problem, for the "find a small
 * failing case" search.
 *
 * Each generator returns the whole stdin as integers, exactly as a test case
 * stores it: for a two-parameter problem the scalar comes first. Inputs are
 * deliberately tiny (a handful of values, small ranges, so repeats and ties
 * are common) with an occasional extreme value, because overflow and boundary
 * bugs are what small hand-made samples miss.
 *
 * Every generator must respect its problem's constraints; an input outside
 * them makes the reference's answer meaningless. `tests/stress/generators.test.ts`
 * checks each one against the problem's own reference solution.
 */

export type Rng = () => number;

/** Deterministic, seedable (mulberry32). */
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const int = (rng: Rng, lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));

/** A small value, or now and then one of the extremes. */
const val = (rng: Rng, lo: number, hi: number, extremes: readonly number[] = []) =>
  extremes.length > 0 && rng() < 0.12
    ? extremes[int(rng, 0, extremes.length - 1)]!
    : int(rng, lo, hi);

const list = (rng: Rng, minLen: number, maxLen: number, item: () => number) =>
  Array.from({ length: int(rng, minLen, maxLen) }, item);

const shuffle = <T>(rng: Rng, items: T[]): T[] => {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = int(rng, 0, i);
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return items;
};

const BIG = 1_000_000_000;
const PM = [BIG, -BIG];

export type StressGenerator = {
  /** One random input, as the stdin integers. */
  generate(rng: Rng, size: number): number[];
  /**
   * Set when items after the header are independent, so dropping one keeps the
   * input valid. `header` is how many leading integers are not items.
   */
  shrink?: { header: 0 | 1; minItems: number };
};

/** `size` grows 1, 2, 3… over a search, so early inputs are the smallest. */
const cap = (size: number, max = 8) => Math.max(1, Math.min(max, size));

const plain = (
  minItems: number,
  item: (rng: Rng) => number,
  header?: (rng: Rng, items: number[]) => number,
): StressGenerator => ({
  generate(rng, size) {
    const items = list(rng, minItems, Math.max(minItems, cap(size)), () => item(rng));
    return header ? [header(rng, items), ...items] : items;
  },
  shrink: { header: header ? 1 : 0, minItems },
});

export const STRESS_GENERATORS: Record<string, StressGenerator> = {
  'signal-frequency-ledger': plain(0, (r) => val(r, -3, 3, PM)),
  'cold-store-aisle-sweep': plain(0, (r) => val(r, -3, 3, PM)),
  'kiln-soak-window': {
    generate(rng, size) {
      const readings = list(rng, 1, cap(size), () => val(rng, -5, 5, PM));
      return [int(rng, 1, readings.length), ...readings];
    },
  },
  'museum-ticket-pair-count': plain(
    0,
    (r) => val(r, -3, 3, PM),
    (r) => val(r, -6, 6, [0, ...PM]),
  ),
  'sorted-dock-insertion': {
    generate(rng, size) {
      const berths = list(rng, 0, cap(size), () => val(rng, -5, 5, PM)).sort((a, b) => a - b);
      return [val(rng, -6, 6, PM), ...berths];
    },
    shrink: { header: 1, minItems: 0 },
  },
  'ferry-weight-rating': {
    generate(rng, size) {
      const weights = list(rng, 1, cap(size), () => val(rng, 1, 9, [BIG]));
      return [int(rng, 1, weights.length), ...weights];
    },
  },
  'histogram-signal-block': plain(0, (r) => val(r, 0, 6, [BIG])),
  'strait-ice-floes': plain(0, (r) => (r() < 0.5 ? -1 : 1) * val(r, 1, 5, [BIG])),
  'pipeline-segment-from-end': plain(
    0,
    (r) => int(r, -5, 5),
    (r) => int(r, 1, 10),
  ),
  'decision-tree-levels': {
    generate(rng, size) {
      const length = int(rng, 0, Math.min(15, cap(size, 15)));
      const out: number[] = [];
      for (let i = 0; i < length; i += 1) {
        const parentMissing = i > 0 && out[Math.floor((i - 1) / 2)] === -1;
        out.push(parentMissing || (i > 0 && rng() < 0.3) ? -1 : int(rng, 0, 9));
      }
      return out;
    },
  },
  'one-counter-open': plain(0, (r) => val(r, 1, 9, [10_000])),
  'audio-track-merge-cost': plain(0, (r) => val(r, 0, 9, [BIG])),
  'constellation-connection-groups': {
    generate(rng, size) {
      const n = int(rng, 1, Math.max(1, Math.min(6, size)));
      const edges = list(rng, 0, cap(size, 6), () => 0).flatMap(() => [
        int(rng, 0, n - 1),
        int(rng, 0, n - 1),
      ]);
      return [n, ...edges];
    },
  },
  'donation-target-subsets': {
    generate(rng, size) {
      const target = int(rng, 0, 10);
      return [target, ...list(rng, 0, cap(size), () => int(rng, 0, target))];
    },
    shrink: { header: 1, minItems: 0 },
  },
  'rising-corridor': plain(0, (r) => val(r, 1, 6, [BIG])),
  'archive-shelf-reward': plain(0, (r) => val(r, 0, 9, [BIG])),
  'harbour-lot-echo': plain(1, (r) => val(r, 0, 5, [BIG])),
  'orchard-cart-haul': plain(
    1,
    (r) => val(r, 0, 9, [BIG]),
    (r) => val(r, 0, 20, [200_000_000_000_000]),
  ),
  'coastal-beacon-spacing': {
    generate(rng, size) {
      const sites = list(rng, 2, Math.max(2, cap(size)), () => val(rng, 0, 20, [0, BIG]));
      return [int(rng, 2, sites.length), ...sites];
    },
  },
  'warehouse-crate-sightlines': plain(1, (r) => val(r, 1, 6, [BIG])),
  'ferris-seat-lottery': plain(
    1,
    (r) => int(r, 1, 9),
    (r) => val(r, 1, 12, [BIG]),
  ),
  'grove-path-yield': plain(1, (r) => val(r, -5, 5, PM)),
  'camp-water-rations': plain(
    1,
    (r) => val(r, 0, 9, [BIG]),
    (r) => int(r, 0, 10),
  ),
  'quay-ferry-hops': plain(1, (r) => int(r, 0, 4)),
  'badge-gate-balance': plain(1, (r) => val(r, 0, 4, [BIG])),
  'festival-banner-cuts': plain(
    1,
    (r) => val(r, 1, 6, [BIG]),
    (r) => val(r, 1, 12, [200_000_000_000_000]),
  ),
  'playlist-heat-segment': plain(1, (r) => int(r, 0, 4)),
  'tour-bus-cuisine-stretch': plain(
    1,
    (r) => int(r, 0, 4),
    (r) => int(r, 0, 4),
  ),
  'bakery-oven-rate': {
    generate(rng, size) {
      const orders = list(rng, 1, cap(size), () => val(rng, 1, 9, [BIG]));
      return [val(rng, orders.length, orders.length + 12, [BIG]), ...orders];
    },
  },
  'ridge-line-lows': plain(1, (r) => val(r, 0, 6, [BIG])),
  'clue-trail-loop': {
    generate(rng, size) {
      const n = int(rng, 1, cap(size));
      return Array.from({ length: n }, () => int(rng, -1, n - 1));
    },
  },
  'archive-index-depth': plain(1, (r) => val(r, 0, 6, [BIG])),
  'ferry-ticket-change': plain(1, (r) => [5, 10, 20][int(r, 0, 2)]!),
  'portal-tile-corridor': plain(1, (r) => val(r, -3, 3, PM)),
  'mosaic-odd-tile': {
    generate(rng, size) {
      const pairs = int(rng, 0, Math.min(3, size));
      const pool = shuffle(
        rng,
        Array.from({ length: 21 }, (_, i) => i),
      );
      if (rng() < 0.12) pool[0] = BIG;
      const values = [pool[0]!, ...pool.slice(1, pairs + 1).flatMap((v) => [v, v])];
      return shuffle(rng, values);
    },
  },
  'spice-trader-voyages': plain(
    1,
    (r) => int(r, 0, 9),
    (r) => val(r, 0, 4, [BIG]),
  ),
  'net-climb-stretches': plain(
    1,
    (r) => val(r, -3, 3, [10_000, -10_000]),
    (r) => int(r, -6, 6),
  ),
  'solar-output-streak': plain(
    1,
    (r) => val(r, 1, 6, [10_000]),
    (r) => int(r, 1, 15),
  ),
  'carousel-tag-count': {
    generate(rng, size) {
      const sorted = list(rng, 1, cap(size), () => val(rng, -5, 5, PM)).sort((a, b) => a - b);
      const k = int(rng, 0, sorted.length - 1);
      return [val(rng, -6, 6, PM), ...sorted.slice(k), ...sorted.slice(0, k)];
    },
  },
  'rooftop-rain-pockets': plain(1, (r) => val(r, 0, 6, [100_000])),
  'courier-route-merge': {
    generate(rng, size) {
      const n = int(rng, 1, cap(size));
      // Pointing only to later nodes in a random order can never form a loop.
      const order = shuffle(
        rng,
        Array.from({ length: n }, (_, i) => i),
      );
      const next = new Array<number>(n).fill(-1);
      order.forEach((node, position) => {
        if (position < n - 1 && rng() < 0.75)
          next[node] = order[int(rng, position + 1, n - 1)]!;
      });
      return [int(rng, 0, n - 1), ...next];
    },
  },
  'gallery-tour-order': plain(1, (r) => val(r, -3, 3, PM)),
  'scrap-press-remnant': plain(1, (r) => val(r, 1, 9, [1_000_000])),
  'workshop-build-order': {
    generate(rng, size) {
      const steps = int(rng, 1, Math.max(1, Math.min(6, size)));
      const rules = list(rng, 0, cap(size, 6), () => 0).flatMap(() => [
        int(rng, 0, steps - 1),
        int(rng, 0, steps - 1),
      ]);
      return [steps, ...rules];
    },
  },
  'beacon-code-contrast': plain(2, (r) => val(r, 0, 15, [1_073_741_823])),
  'bead-string-harvest': plain(1, (r) => val(r, 0, 9, [100])),
  'cloakroom-free-tag': plain(0, (r) => val(r, -2, 9, [2_147_483_647, -2_147_483_648])),
  'backdrop-flat-span': plain(2, (r) => val(r, 0, 6, [BIG])),
  'busker-encore-number': {
    generate(rng, size) {
      return list(rng, 1, cap(size), () => val(rng, 0, 9, [BIG])).sort((a, b) => a - b);
    },
    shrink: { header: 0, minItems: 1 },
  },
  'trail-checkpoint-ramp': plain(1, (r) => val(r, -5, 9, [-500, 9000])),
  'relay-water-station': {
    generate(rng, size) {
      const n = int(rng, 1, cap(size));
      const next = Array.from({ length: n }, () => int(rng, -1, n - 1));
      // A loop-free course from station 0: a random path of distinct stations.
      const others = shuffle(
        rng,
        Array.from({ length: n - 1 }, (_, i) => i + 1),
      );
      const path = [0, ...others.slice(0, int(rng, 0, others.length))];
      path.forEach((station, i) => {
        next[station] = i + 1 < path.length ? path[i + 1]! : -1;
      });
      return next;
    },
  },
  'cave-survey-span': {
    generate(rng, size) {
      const n = int(rng, 1, cap(size));
      const order = shuffle(
        rng,
        Array.from({ length: n }, (_, i) => i),
      );
      const parent = new Array<number>(n).fill(-1);
      order.forEach((node, position) => {
        if (position > 0) parent[node] = order[int(rng, 0, position - 1)]!;
      });
      return parent;
    },
  },
  'rehearsal-room-bookings': {
    generate(rng, size) {
      return list(rng, 0, Math.min(5, size), () => 0).flatMap(() => {
        if (rng() < 0.1) return [0, BIG];
        const start = int(rng, 0, 10);
        return [start, int(rng, start + 1, 12)];
      });
    },
  },
  'pneumatic-tube-alarm': {
    generate(rng, size) {
      const stations = int(rng, 1, Math.max(1, Math.min(5, size)));
      const tubes = list(rng, 0, Math.min(5, size), () => 0).flatMap(() => [
        int(rng, 0, stations - 1),
        int(rng, 0, stations - 1),
        val(rng, 1, 9, [10_000]),
      ]);
      return [stations, ...tubes];
    },
  },
  'courtyard-sentry-posts': {
    generate(rng, size) {
      const n = int(rng, 1, Math.max(1, Math.min(4, size)));
      const fountains = list(rng, 0, Math.min(5, size), () => 0).flatMap(() => [
        int(rng, 0, n - 1),
        int(rng, 0, n - 1),
      ]);
      return [n, ...fountains];
    },
  },
  'lighthouse-stair-effort': plain(1, (r) => val(r, 0, 9, [1000])),
};

/** The stdin a test case would hold for these integers. */
export const toStdin = (values: readonly number[]): string => values.join(' ');

/**
 * Inputs one integer smaller: each item dropped in turn, header kept, never
 * below the problem's minimum. Empty for problems whose items are not
 * independent (pairs, pointers, a scalar tied to the length).
 */
export function shrinkCandidates(
  generator: StressGenerator,
  values: readonly number[],
): number[][] {
  const rule = generator.shrink;
  if (!rule) return [];
  const items = values.length - rule.header;
  if (items <= rule.minItems) return [];
  const out: number[][] = [];
  for (let i = rule.header; i < values.length; i += 1) {
    out.push([...values.slice(0, i), ...values.slice(i + 1)]);
  }
  return out;
}
