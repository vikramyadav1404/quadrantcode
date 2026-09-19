# Screenshots

Four captures, referenced from the root `README.md`. Filenames are fixed — the
README links to them by name, so a rename breaks the front page.

| File               | Route                    | Viewport   | What it has to show                                                                                    |
| ------------------ | ------------------------ | ---------- | ------------------------------------------------------------------------------------------------------ |
| `01-solve.png`     | `/problems/<slug>/solve` | 1440 × 900 | The editor beside the problem panel, with the timer bar running. This is the differentiator; it leads. |
| `02-dashboard.png` | `/dashboard`             | 1440 × 900 | Streak, this week's solving, average time, and the weak-topic callout.                                 |
| `03-session.png`   | `/sessions/<id>`         | 1440 × 900 | The timeline of one solve — run attempts, snapshots, and a confirmed stuck point.                      |
| `04-revision.png`  | `/revision`              | 1440 × 900 | The queue with items actually due, not an empty state.                                                 |

> **The heatmap is not on the dashboard.** It renders on `/settings/goals` and
> nowhere else — `app/(app)/dashboard/page.tsx` never imports it. An earlier
> revision of this table said otherwise, which sent someone looking for a
> component that was never on that page. If the four frames should include it,
> it needs a fifth capture or a decision to move it.

## Before capturing

Sign in as the demo account, which has a month of seeded history — an empty
dashboard photographs as a broken product. `scripts/demo-seed.ts` has the
details; `scripts/magic-link.ts` mints a link without sending email.

For `03-session.png`, use the `timelineSessionId` the seed prints. It is the one
session that gets snapshots, run attempts and a confirmed stuck point, so it is
the only one with a story to show.

## What must not be in frame

- **The session token or any magic-link URL.** Both are live credentials.
- A real email address in the account menu — the demo account reads
  `demo@quadrantcode.local`, which is the point of it.
- Browser chrome with the deployment URL, if the deployment is not meant to be
  public yet.
- Any devtools panel.

## Theme

Capture in whichever theme you prefer, but **use the same one for all four**.
Mixed themes across a four-image strip reads as inconsistency rather than as a
feature.

## Retina

If capturing at 2×, keep the CSS viewport at 1440 × 900 and let the file be
2880 × 1800. Do not capture at a 2880 CSS width — the layout changes, and the
result shows a page nobody sees.
