# Scoring

How Quadrantcode turns what you have done into a number, in prose. The code is
`server/services/analytics/scoring.ts`; this file exists so the reasoning is
legible without reading it.

Later tickets extend this document rather than starting their own: F2.1 adds the
forgetting-risk model, F3.3 the confidence tiers for inferred stuck points, F3.5
the composite weak-topic score that supersedes the one below.

---

## The weak-topic score (F1.6)

**It is arithmetic over things that already happened.** Four measurements, each
squeezed into a 0–1 range, multiplied by fixed weights that sum to 1, scaled to
0–100. Same inputs, same number, every time — and every row on the page carries
the sentences that produced it, so a user can disagree with it.

That last part is the design constraint, not a nicety. A number nobody can check
is a number nobody acts on. "Graphs: 71" says nothing; "graphs — not practised
in 18 days, and 4 of 10 attempts ended stuck" is a claim the reader can test
against their own memory.

```
score = 100 × ( 0.35 × staleness
              + 0.30 × failureRate
              + 0.20 × lowConfidence
              + 0.15 × slowness )
```

### The four components

**Staleness — days since you last practised the topic, over 21.**
Capped at 1, so three weeks and three years score the same. Past that point the
advice does not change, and letting it keep growing would let one topic's age
drown out every other signal in the ranking.

**Failure rate — sittings that ended `stuck`, over all finished sittings.**
Abandoned sittings are in neither number: walking away from a tab is not
evidence about a subject. (Same judgement D20 makes when it refuses to count
abandonment as an attempt.)

**Low confidence — your average answer, inverted.**
`low = 1`, `medium = 2`, `high = 3`, mapped so that consistently answering "low"
gives 1 and consistently answering "high" gives 0. **An unanswered question
contributes exactly 0.5 — neutral.** F1.5 goes out of its way to make the
reflection skippable, so treating silence as low confidence would punish the
users who took that at face value, and treating it as high would reward them.
Neither is supported by anything.

**Slowness — active time over the problem's estimate, minus one.**
Capped at double the estimate. Finishing faster than the estimate is 0, not a
negative — being quick at a topic is not evidence of weakness, it is just the
absence of this signal.

### Why the weights are in that order

**Staleness leads (0.35)** because it is the only component that grows while the
user does nothing, and it is the one a plan can always act on: "practise this
again" is available advice for any topic on any day.

**Failure rate follows (0.30)** because a `stuck` outcome is the user's own
verdict that they could not finish. That is stronger evidence than anything
below it, and it is not a guess about them — it is a thing they said.

**Low confidence is third (0.20)** because it is self-reported and optional,
which makes it the noisiest input here. It deserves a real share of the score
and not the largest one.

**Slowness is last (0.15)** because the estimate it compares against is a
property of the PROBLEM, not of the user. A generously or stingily estimated
problem moves this component for reasons that have nothing to do with how the
solve went, so it gets the smallest vote.

### Two thresholds that keep the list honest

**A topic needs three finished sessions before it is ranked at all.** A ratio
over a denominator of one is either 0 or 1, so a topic tried once and abandoned
would sit above one the user has genuinely struggled with for months.

**Ties break on topic name.** A list that reshuffles between reloads reads as
noise however good the numbers are.

### What it is not

It does not model the future, and nothing in the codebase says it does — there
is a test (`tests/analytics/wording.test.ts`) that reads the analytics source,
components, page and this file, and fails if the words creep in. The rule comes
from the F1.6 ticket and from **C4**: Quadrantcode does not claim certainty it does
not have.

The honest description is the one at the top: it adds up four things you already
did, and shows you which ones it added.

---

## The forgetting-risk score (F2.1)

**Which of today's due problems to put first.** Six things that already
happened, normalised to 0–1, weighted, and added up to a 0–100 number. Like the
weak-topic score above, it ranks — it does not foretell — and every entry in the
queue carries the sentences that put it where it is.

```
risk = 100 × ( 0.30 × overdue
             + 0.20 × lowConfidence
             + 0.20 × failedAttempts
             + 0.15 × mistakeSeverity
             + 0.10 × topicWeakness
             + 0.05 × hints )
```

### The six inputs

**Overdue** — days past the due date, over 14. It leads because it is the only
component that grows on its own, and because being overdue is the thing the
queue exists to act on. Everything else describes how a solve went; this
describes how long ago it was.

**Low confidence** — the user's own answer, inverted, with an unanswered
question contributing exactly nothing either way. The same decision F1.6 makes,
for the same reason: F1.5 makes the reflection skippable, so silence must not be
read as either an admission or a boast.

**Failed attempts** — sittings on this problem that ended `stuck`, over 3.

**Mistake severity** — the WORST mistake recorded, not the sum of them:

| Tier                                | Categories                                                                    | Weight |
| ----------------------------------- | ----------------------------------------------------------------------------- | ------ |
| Structural — the approach was wrong | `wrong_logic`, `wrong_data_structure`                                         | 1.0    |
| Conceptual — a case was missed      | `missed_edge_case`, `boundary_condition`, `off_by_one`, `recursion_base_case` | 0.6    |
| Mechanical — it ran wrong           | `syntax_runtime`, `tle`                                                       | 0.3    |
| Nothing went wrong                  | `none`                                                                        | 0      |

A wrong data structure plus a typo is a wrong data structure. Summing would rank
it above an identical problem without the typo, which says nothing useful about
either.

**Topic weakness** — the F1.6 weak-topic score, reused rather than
reimplemented. Weighted low because it is a fact about the SUBJECT rather than
this problem: useful for breaking ties, wrong as a main driver.

**Hints** — weighted smallest, and currently always zero. Hints come from F3.4,
which is cut. It is weighted honestly now rather than bolted onto a scheduler
people already trust.

---

## The revision ladder (F2.1)

Not a score, but the other half of the same decision, and the reasoning belongs
beside it.

```
standard    1 · 3 · 7 · 14 · 30 days
compressed  1 · 2 · 5 · 10 · 21 days
```

**Confidence picks the ladder; every other signal picks the rung.** Low
confidence is a statement about the whole solve, so it shortens every gap that
follows rather than knocking off one step and then behaving normally. The two
ladders are the same length, so "rung 3" means the same thing on both.

Hints taken, two or more failed attempts, and a solve past 1.5× the estimate
each compress one rung. A solve that is confident AND unaided AND inside the
estimate stretches one — all three, because a scheduler that stretches eagerly
loses the problem, and being wrong in that direction costs far more than
repeating a revision the user did not need.

**Intervals never fall below one day**, however many signals stack.

After a revision: `clean` advances a rung, `struggled` repeats the same
interval, `failed` returns to one day. `struggled` exists so a user barely
holding on is not pushed to a longer gap by a system that only knows pass and
fail.

### What the ninety-day simulation showed

`tests/revision/simulation.test.ts` runs ninety days of a synthetic user against
the pure module and prints the daily queue depth. At a new problem every other
day it peaks at **11** against the criterion's ceiling of 20, and **arrears —
work still waiting more than a week after it came due — stay at zero.**

The daily due count does climb over the ninety days, and that is not the
scheduler falling behind: a user who adds a problem every other day owns twice
as many on day 90 as on day 45, and twice as many problems generate twice as
many revisions.

**At one new problem a day, five revisions a day is not enough.** Arrears appear
and depth passes 20. So the default cap of five is a statement about how many
problems a user can take on, not a free parameter — and it is asserted in the
simulation rather than reasoned about here.

---

## F3.3 · stuck inference — confidence tiers and the inferred discount

### The four tiers

| Tier          | What produced it                                           | Shown as                 |
| ------------- | ---------------------------------------------------------- | ------------------------ |
| `user_marked` | The user pressed "I'm stuck"                               | "You marked this"        |
| `high`        | A long dwell, heavy churn, or three-plus failures in a row | "Likely a stuck point"   |
| `medium`      | The same signals at their threshold                        | "Possibly a stuck point" |
| `low`         | Idle after a failure, always                               | "Might be a stuck point" |

Every label hedges except the first, and the first is not a hedge because it is
not a guess. A test greps the module and its UI for "detected", "exactly", "you
got stuck at" and three more, with a control proving each pattern fires.

### The discount factor: 0.4

An unconfirmed inference counts **0.4** against a confirmed one at **1.0**. A
dismissed one counts **0**.

The number is chosen so two unconfirmed inferences still weigh less than one
thing the user actually said (0.8 < 1.0). Nothing derived should be able to
outvote the person, however much of it accumulates.

Dismissed is zero rather than a small number on purpose: the user said it was
wrong, and continuing to count it a little is disagreeing with them quietly.

**`source` and `status` answer different questions.** `source` is who proposed
it; `status` is whether the user agreed. An inference they confirmed stays
`inferred` in origin and becomes `confirmed` in standing — and the standing is
what decides weight, so a confirmed inference counts exactly as much as a marker
the user typed. That is the point of asking.

### What each signal will and will not claim

| Signal               | Fires when                                                             | Refuses to fire when                                                     |
| -------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `edit_locality`      | Edits return to a narrow window for over 2 minutes with no passing run | The edits never come back — that is progress down a file, not dwelling   |
| `edit_churn`         | A range's edits outnumber its distinct lines, 3+ times                 | Seven lines touched once each; that is coverage, not repetition          |
| `failure_cluster`    | 2+ consecutive failed runs with edits between them                     | Nothing was edited between the failures — there is no region to point at |
| `idle_after_failure` | A gap of 90s+ right after a failure                                    | Never above `low`, however long the silence                              |
| `user_marker`        | The user said so                                                       | Never carries a line range — F1.5 records a marker without asking where  |

### `edit_locality` is not cursor dwell

The ticket names cursor dwell: the cursor within ±3 lines for over two minutes.
**There is no cursor telemetry in this project** — no event type, nothing in the
editor emitting one, and adding it would mean sampling a position every few
seconds for a whole session and rewriting the privacy copy F3.2b shipped.

So this measures where the **edits** were. It is a different measurement and it
carries a different name, because calling it cursor dwell would be a claim about
something nothing watched.

---

## F3.5 · mistake memory — the trend rule and the composite

### The trend rule

Compare the **rate** over the last 30 days against the rate over the 30 before
that. A running total only goes up, so every pattern would read "worsening"
forever and the word would stop meaning anything.

```
improving  ·  recent < earlier × 0.8   AND   earlier − recent >= 2
worsening  ·  recent > earlier × 1.2   AND   recent − earlier >= 2
flat       ·  everything else
```

**Two thresholds, not one.** A percentage margin alone does not protect small
patterns: 20% of four is 0.8, so a single occurrence clears it and most patterns
flip label on one event. The absolute floor of 2 is what stops that — and the
test caught the omission on its first run.

**A user who stopped practising has not improved.** Fewer than 3 solves in the
recent window and no trend is claimed, in either direction. Counting mistakes
rather than mistakes-per-attempt has that blind spot, and `NEEDS_ACTIVITY` is
where it is admitted rather than hidden.

### Severity, and what it does to a revision

```
base       = min(1, occurrences / 5)
direction  = worsening 1.2 · flat 1.0 · improving 0.6
severity   = min(1, base × direction)
```

Fed into F2.1's `MISTAKE_SEVERITY`, which has had a slot for it since that
ticket. The risk factor takes the **max** of the worst mistake on this problem
and this recurrence figure — not a sum, not an average. A severe one-off and a
mild habit are both reasons to revise sooner, and neither should cancel the
other out.

When recurrence is what raised the score, the factor's label says so ("a mistake
you keep repeating") rather than naming this attempt. The reason has to match
the number, or it points the user at the wrong thing.

### The weekly plan

```
score = severity × recency
recency = 1 within a week, tapering to 0 at 90 days
```

Top 3 areas, 5 problems shared in proportion, everyone gets at least one. A plan
that assigns four to one area and zero to another is one item pretending to be
three.

**Every recommendation carries its reason**, produced by the same function from
the same inputs — there is no code path that emits one without the other. The
reason names what actually drove it (direction, confirmed stuck points, or
recency), because a reason that would fit any recommendation is not a reason.

### Two taxonomies, counted apart

`occurrences` counts `mistake_category` — what went wrong.
`confirmedStuckCount` counts `stuck_category` — where the struggle was. Adding
them would produce a number that means neither.

Only **confirmed** stuck points count. An unanswered inference is a guess, and
padding a user's record with guesses they never saw makes the panel something to
argue with rather than act on.
