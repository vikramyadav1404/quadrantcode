# Scoring

How TraceLoop turns what you have done into a number, in prose. The code is
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
from the F1.6 ticket and from **C4**: TraceLoop does not claim certainty it does
not have.

The honest description is the one at the top: it adds up four things you already
did, and shows you which ones it added.
