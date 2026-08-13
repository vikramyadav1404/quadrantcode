/**
 * Client-payload capture.
 *
 * Built for F2.2's blind-retry criterion — "previous code must not reach the
 * client at all: not in the RSC payload, not in a props blob, not in a
 * prefetched route… verify by inspecting the network response, not by trusting
 * that the component does not render it."
 *
 * It exists now, with its own passing spec, so that when F2.2 lands the leak
 * check is a three-line assertion rather than new infrastructure written under
 * deadline.
 *
 * What "the full client payload" means here — every one of these can carry a
 * server value to the browser, and checking only the first is the usual mistake:
 *
 *   1. the HTML document (inlined RSC flight data in `self.__next_f`)
 *   2. every subsequent RSC flight response (`?_rsc=` requests)
 *   3. every JS chunk fetched for the route
 *   4. every JSON/fetch response the page makes
 *   5. prefetch responses triggered by <Link> hover or viewport entry
 */
import type { Page, Response } from '@playwright/test';

export type CapturedResponse = {
  url: string;
  status: number;
  contentType: string;
  body: string;
};

export type PayloadCapture = {
  /** Every response body collected since capture began. */
  responses: CapturedResponse[];
  /** All bodies concatenated — the haystack for a leak search. */
  combined(): string;
  /**
   * Responses whose body contains `needle`. Empty means the value never
   * reached the browser by any route.
   */
  find(needle: string): CapturedResponse[];
  /**
   * Stops recording and waits for in-flight body reads to finish.
   *
   * MUST be awaited before assertions. Playwright fires `response` before the
   * body is available, so an un-awaited read is both a race (a late body is
   * missed, producing a false "no leak") and a crash source (the read rejects
   * when the page closes at end of test).
   */
  stop(): Promise<void>;
};

/** Binary and font responses cannot carry a leaked string in readable form. */
const IGNORED_TYPES = /^(image|font|video|audio)\//;

/** Per-body read budget. See `readBody` for why this is not optional. */
const BODY_READ_TIMEOUT_MS = 5_000;

/**
 * Reads a response body with a hard deadline.
 *
 * Next.js STREAMS the RSC payload, and `response.text()` does not resolve until
 * the stream closes. A response that stays open therefore hangs the capture
 * forever — which showed up as a bare "Test timeout of 30000ms exceeded" with
 * no indication of the cause. Bounding each read turns that into a recorded
 * empty body, which is the safe direction: a body we could not read is never
 * counted as "no leak found", because the positive control would fail first.
 */
async function readBody(response: Response): Promise<string> {
  let timer: NodeJS.Timeout | undefined;

  const deadline = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(''), BODY_READ_TIMEOUT_MS);
  });

  try {
    return await Promise.race([response.text().catch(() => ''), deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Starts recording every response the page receives.
 *
 * Call BEFORE navigating — responses arriving before this runs are not
 * captured, which is exactly how a leak check produces a false negative.
 */
export function capturePayload(page: Page): PayloadCapture {
  const responses: CapturedResponse[] = [];
  const pending: Array<Promise<void>> = [];
  let recording = true;

  const onResponse = (response: Response) => {
    if (!recording) return;

    pending.push(
      (async () => {
        const contentType = response.headers()['content-type'] ?? '';
        if (IGNORED_TYPES.test(contentType)) return;

        // Redirects, 204s, aborted requests and still-open streams all yield
        // an empty body rather than throwing — none of them can leak.
        const body = await readBody(response);

        responses.push({ url: response.url(), status: response.status(), contentType, body });
      })(),
    );
  };

  page.on('response', onResponse);

  return {
    responses,
    combined() {
      return responses.map((response) => response.body).join('\n');
    },
    find(needle: string) {
      return responses.filter((response) => response.body.includes(needle));
    },
    async stop() {
      recording = false;
      page.off('response', onResponse);
      await Promise.allSettled(pending);
    },
  };
}

/**
 * Waits for the page to go quiet.
 *
 * `networkidle` alone is not enough, and it can also never resolve on a page
 * holding a long-lived connection, so both waits are guarded — a closed page
 * during teardown is not a test failure.
 */
export async function settle(page: Page, quietMs = 400): Promise<void> {
  if (page.isClosed()) return;

  /*
   * Bounded. Without an explicit timeout this inherits the test budget, so a
   * page that never reaches idle burns the whole 30s and reports as a timeout
   * rather than as 'no idle' — which is what happened first time round.
   */
  await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {
    /* never reached idle; the explicit wait below still flushes bodies */
  });

  if (page.isClosed()) return;
  await page.waitForTimeout(quietMs).catch(() => {
    /* page closed while waiting — nothing left to capture */
  });
}

/** Triggers Next.js <Link> prefetching so prefetch payloads are captured too. */
export async function triggerPrefetches(page: Page): Promise<void> {
  if (page.isClosed()) return;

  const links = await page.locator('a[href^="/"]').all();
  for (const link of links.slice(0, 20)) {
    await link.hover({ timeout: 2000 }).catch(() => {
      // Off-screen or detached links cannot be hovered; viewport-entry
      // prefetching still covers them.
    });
  }
  await page.waitForTimeout(300).catch(() => {});
}
