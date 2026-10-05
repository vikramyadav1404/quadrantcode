/**
 * The solve screen, v1: problem on the left, editor on the right.
 *
 * The data and both halves are built by `app/_solve/load-solve.tsx` (shared
 * with the v2 route, C2); see that file for what each pane may show and why.
 * This page places them in the split pane exactly as it always has.
 *
 * It imports nothing from v2. While FEATURE_SOLVE_V2 is on, middleware rewrites
 * this URL to `/problems/[slug]/solve/v2` (lib/solve-v2/rewrite.ts), so v2's
 * code lives in a different route bundle and never reaches v1's.
 */
import { SplitPane } from '@/components/solve/SplitPane';
import { loadSolve } from '@/app/_solve/load-solve';

export default async function SolvePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { problemPanel, editor } = await loadSolve(slug);

  return (
    <SplitPane
      leftLabel="the problem"
      rightLabel="the editor"
      left={problemPanel}
      right={editor}
    />
  );
}
