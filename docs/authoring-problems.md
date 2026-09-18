# Authoring an original problem

How to write one problem record, prove it, and publish it. Written so nobody has
to reconstruct this from the schema and three services again.

> **The thing this document exists to prevent.**
> `scripts/generate-native-problem-library.ts` produced 100 records from 10
> problems: 100 distinct slugs, titles, statements and stories over 10 distinct
> test-case sets, 10 reference solutions and **one** function contract. The
> difficulty labels were assigned per skin, so the same problem appears as easy,
> medium and hard. See **D27**.
>
> **One record is one problem.** If a new record shares its test cases with an
> existing one, it is a skin, not a problem. Delete it.

---

## 1 · The rules

| Rule                                  | What it means in practice                                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Patterns are free, wording is not** | Sliding window, monotonic deque, union-find — reuse any of them. Do not reuse a sentence, a variable name from someone's editorial, or a worked example from any platform.                         |
| **Your own story**                    | Invent the setting. It should motivate the question, not decorate it: if the story can be deleted without changing the problem, it is decoration.                                                  |
| **Your own example values**           | Never copy a sample input from anywhere. Make up numbers and work the answer out by hand.                                                                                                          |
| **C2**                                | `provenance.contentSource` is `quadrantcode-original` and `independentlyCreated` is `true`. Both are literals in the schema — you cannot write a record that says otherwise.                       |
| **C3**                                | If you attach a company, `evidenceType` must be `company_pattern`, `sourceUrl` must be `null`, `reportCount` must be `0`. The schema rejects anything else. Never imply a real interview question. |
| **Honest difficulty**                 | The label describes the problem, not the skin. Write the reasoning into `difficultyCalibration` and be prepared to defend it.                                                                      |

### Naming the pattern is allowed; hiding it is the problem

Say plainly in the editorial which technique the intended solution uses. A
reader who recognises the pattern loses nothing, and a reader who does not gets
a name to go and learn. What is not allowed is lifting the explanation.

---

## 2 · What the wrappers support today

**One shape, and it is narrow.** Every existing wrapper reads one line of
whitespace-separated integers into a single array and prints one integer.

|                               |                                                 |
| ----------------------------- | ----------------------------------------------- |
| `functionContract.parameters` | exactly one, `values`, type `integer[]`         |
| `functionContract.returnType` | `64-bit integer`                                |
| stdin                         | whitespace-separated signed integers, one array |
| stdout                        | one signed integer                              |
| equality                      | `exact_json` — see the gotcha below             |

The five signatures, which you copy verbatim:

```
c11         long long solve(const long long *values, int n)
cpp17       long long solve(const vector<long long>& values)
java        static long solve(long[] values)
python3     def solve(values: list[int]) -> int
javascript  function solve(values)
```

### Encoding a second parameter

There is no second parameter. A problem needing one packs it into the array,
conventionally at `values[0]`, with the data following. **Say so in
`inputFormat` in the problem's own language, not ours** — "the first number is
the width of the soak", not "values[0] is W". A solver should not be able to
feel our plumbing through the statement.

### What needs a new wrapper

Anything that is not `int[] → int`. Strings, floats, a returned array, a tree or
graph given as structured input, multiple test cases per run, a `className` for
a method-on-class contract. The schema has the fields for these
(`functionContract.className`, richer `serialization`), but **no wrapper
implements them**, so writing such a record produces something that cannot be
validated or run. Adding a wrapper means editing all five `wrapperTemplate`
strings and re-validating every existing problem.

Pick a problem that fits the shape, or budget the wrapper work first.

---

## 3 · The record, as a template

A problem lives inside a batch file, `data/native-problems/batch-NN.json`:

```jsonc
{
  "schemaVersion": 1,
  "batch": 2,
  "reviewStatus": "needs_review",
  "problems": [/* records */],
}
```

One record. Every field is required unless marked. Limits are from
`server/services/native-content/schema.ts`; that file is the authority.

```jsonc
{
  "slug": "kebab-case", // 3-100 chars, unique across the library
  "title": "Title Case", // 5-120 chars, unique (case-insensitive)
  "difficulty": "easy|medium|hard",
  "primaryTopic": "two-pointers-sliding-window", // one of the 10 topic slugs
  "topics": ["two-pointers-sliding-window", "..."], // 1-8, MUST include primaryTopic
  "problemType": "function", // only value the enum allows
  "version": 1,
  "status": "needs_review", // enum allows draft too, but a NEW record must be
  // needs_review or the library test fails — see §4 step 3
  "estimatedMinutes": 30, // 5-240, honest median solve time
  "difficultyCalibration": 0, // -2..2; 0 = label is right, +1 = harder than it looks

  "story": "40-4000 chars. The setting, and why the question matters in it.",
  "statement": "80-20000 chars. The question, precisely.",
  "inputFormat": "20-4000 chars. In the problem's language.",
  "outputFormat": "20-4000 chars.",

  "functionContract": {
    "functionName": "solve",
    "parameters": [{ "name": "values", "type": "integer[]", "description": "8-500 chars." }],
    "returnType": "64-bit integer",
  },

  "constraints": ["3-20 entries", "each 3-500 chars"],

  "examples": [
    // 2-6 entries
    {
      "input": "3 1040 1043 1041",
      "output": "3", // min 1 char
      "explanation": "20-3000 chars. Work it through; do not just restate.",
    },
  ],

  "testCases": [
    // 6-80 entries; see the rules below
    {
      "visibility": "sample|visible|hidden",
      "input": "whitespace-separated integers",
      "expectedOutput": "one integer", // min 1 char, JSON-parseable
      "explanation": "optional, max 2000",
      "coverage": "sample|empty|minimum|maximum|duplicates|adversarial|performance|typical",
      "isPerformance": false,
    },
  ],

  "timeLimitMs": 2000, // 250-20000
  "memoryLimitKb": 262144, // 16384-1048576
  "hints": ["2-8 entries", "each 15-1000 chars, escalating"],

  "editorial": {
    "overview": "80-10000",
    "bruteForceApproach": "40-10000, or null",
    "optimalApproach": "80-12000",
    "correctnessProof": "80-12000 — why it is right, not a restatement of how",
    "timeComplexity": "O(n)",
    "spaceComplexity": "O(n)",
  },

  "languages": { "c11": {}, "cpp17": {}, "java": {}, "python3": {}, "javascript": {} },

  "provenance": {
    "contentSource": "quadrantcode-original", // literal
    "independentlyCreated": true, // literal
    "licenseName": "Quadrantcode Original Content License",
    "licenseUrl": null,
    "author": "3-120 chars",
    "note": "20-2000 chars. How it was written.",
  },

  "companies": [], // max 10; see C3 above
}
```

Each entry in `languages` carries `displayName`, `runtimeVersion`,
`judge0LanguageId`, `functionSignature`, `starterCode`, `wrapperTemplate`,
`serialization` and `referenceSolution`. **Copy all of them from an existing
record and change only `referenceSolution`.** The wrappers are shared
infrastructure; a per-problem edit to one is how five languages silently stop
agreeing.

### Test-case rules the schema enforces

- at least **6** test cases
- at least **2** non-hidden (`sample` or `visible`)
- at least **3** hidden
- coverage must include **`minimum`**, **`maximum`** and **`adversarial`** — all
  three, by name, or the record is rejected

`minimum` and `maximum` mean the constraint extremes, not small and large
inputs. `adversarial` means input chosen to break a plausible wrong solution:
the overflow case, the sorted case, the all-equal case.

---

## 4 · The commands, in order

```bash
# 1 · write the record into a batch file

# 2 · shape, limits, uniqueness, distribution
npm run native:validate

# 3 · library invariants — DO NOT SKIP, see below
npx vitest run tests/native-content tests/assessments

# 4 · compile and run all five reference solutions against every test case
npm run native:validate-references

# 5 · import into the database (needs DATABASE_URL)
npm run native:import

# 6 · publish through the admin surface, never by hand
#     /admin/problems → review → publish
```

Steps 2 and 4 need no database; step 3 needs one for part of its suite. Step 4
needs `gcc`, `g++`, `javac`, `python` and `node` on PATH.

### Step 3 is not optional, and here is the proof

`npm run native:validate` checks the Zod schema, and the schema permits
`status: "draft"`. `tests/native-content/actual-library.test.ts` separately
requires every record to be `needs_review`, because that is what the batch
envelope declares and what the import relies on.

`kiln-soak-window` was authored with `status: "draft"`, passed steps 2 and 4,
and was committed — with a failing test nobody had run, because this list did
not mention it. **A record can satisfy the schema and still break the library.**
Use `needs_review` for a new record; `draft` reads like the honest choice for
something unreviewed and is the wrong one here.

### The library is fixed at exactly 100

`validateNativeLibrary` throws unless the library holds **exactly 100**
problems, and `loadNativeProblemBatches` reads only `batch-01.json` through
`batch-10.json`. Consequences, both of which will surprise you:

- **A `batch-11.json` is never read.** It is not an error; the file is ignored.
- **You cannot append.** A 101st problem fails the load with
  `Native library must contain exactly 100 problems; found 101`, and because
  the reference validator loads through the same path, _nothing_ validates —
  not your problem, not the existing ones.

### Check the papers before you pick a record to replace

**40 of the 100 problem slugs are referenced by `data/assessment-papers.json`.**
Replacing one of those changes its slug, and the paper import then throws
`Unknown original problem <slug>` — which fails
`tests/native-content/importer.test.ts` and
`tests/assessments/content-library.test.ts`, not the two validate commands.

`rising-corridor` was first written over `research-grant-selection`, which a
paper needed, and moved to `nonadjacent-vault-yield` once step 3 caught it. The
first two authored records happened to land on unreferenced slugs, which was
luck rather than care.

Run this first and pick a slug it prints:

```bash
node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync('data/assessment-papers.json','utf8'));const papers=Array.isArray(d)?d:(d.papers||[]);const used=new Set();for(const p of papers)for(const q of p.questions)used.add(q.problemSlug);const all=[];for(const f of fs.readdirSync('data/native-problems').filter(x=>x.endsWith('.json')))for(const p of JSON.parse(fs.readFileSync('data/native-problems/'+f,'utf8')).problems)all.push(p);for(const p of all)if(!used.has(p.slug))console.log('free',p.difficulty.padEnd(7),p.primaryTopic.padEnd(28),p.slug)"
```

Rewriting a paper to point at the new slug is the other option, and it is worse:
the papers are generated content headed for replacement too, so editing one
spends effort on something being thrown away.

So authoring today means **replacing** an unreferenced generated record in
place, matching its `primaryTopic` and `difficulty` so the distribution counts
still hold
(`NATIVE_TOPIC_DISTRIBUTION` and `NATIVE_DIFFICULTY_DISTRIBUTION` are both
checked).

That is a constraint of the generated library, not a good rule. When the last
generated record is gone, the `=== 100` check and the hard-coded batch range
should go with it — until then it is the only thing keeping the distribution
honest.

---

## 5 · Gotchas, each one found the hard way

**`expectedOutput` must be JSON-parseable.** Equality is `exact_json`
(`outputsMatch` in `server/services/execution/native.ts`), not string compare.
`"42"` is fine. `"42 "`, `"+42"`, `"0042"` and an empty string are not. Write
the digits and nothing else.

**Edit before import, not after.** The import upserts by slug, but the database
is not the source of truth — `data/native-problems/` is. Editing a row in
`/admin/problems` and then re-importing silently reverts your edit. Change the
JSON, re-validate, re-import.

**`invalidateReview` resets validation.** Any content edit through the admin
service — statement, a test case, a reference solution — calls
`invalidateReview`, which drops `validationHash` to `null` and puts the problem
back to `needs_review`. A previously validated problem becomes unvalidated the
moment you touch it. That is the point, but it means **every content edit costs
a full re-validation**, and a problem that was `published` stops being
publishable until it passes again.

**A strict check is worth more than a clever one.** `scripts/seed-companies.ts`
rejects an overview containing "previously asked question" even inside a
disclaimer saying the opposite. The first version of a Flipkart overview was
rejected that way and the sentence was reworded rather than the check loosened.
A false positive costs one edit; a false negative ships a claim we cannot stand
behind.

**Validation validates everything.** `native:validate-references` compiles and
runs all five languages against every test case of all 100 problems — roughly
3,000 executions. It is minutes, not seconds. Run it in the background.

**The distribution can be right while the content is wrong.** The generated
library's 35/45/20 split is exactly what the spec asked for, and it measures
nothing, because the labels were assigned per skin. Counting records is not
checking them. If you add a guard to this pipeline, make it one that _compares_
records — unique test-case sets against record count — rather than one that
counts them.

---

## 6 · Picking the next problem

### Where the library stands

Replacing a record keeps the topic and difficulty counts intact, so the order is
a free choice. Run this to see what is left:

```bash
node -e "const fs=require('fs');const all=[];for(const f of fs.readdirSync('data/native-problems').filter(x=>x.endsWith('.json')))all.push(...JSON.parse(fs.readFileSync('data/native-problems/'+f,'utf8')).problems);const g=new Map();for(const p of all){const k=JSON.stringify(p.testCases);if(!g.has(k))g.set(k,[]);g.get(k).push(p);}console.log('records',all.length,'distinct',g.size);[...g.values()].sort((a,b)=>b.length-a.length).forEach(ps=>console.log(String(ps.length).padStart(3),ps[0].primaryTopic,ps.length===1?'('+ps[0].slug+')':''))"
```

A group of size 1 is an authored problem. Any group larger than 1 is that many
skins of one generated problem.

### Replace in this order

The ranking is by two things: how many skins one record removes, and whether the
topic fits the `int[] → int` wrapper without the encoding leaking into the
statement.

| Order | Topic                 | Skins | Why                                                                                                                     |
| ----- | --------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------- |
| 1     | `arrays-hashing`      | 15    | The largest group in the library — one record is the biggest single honesty win available. Natural fit for the wrapper. |
| 2     | `dynamic-programming` | 12    | Large group, and a one-dimensional DP over a sequence is exactly `int[] → int`.                                         |
| 3     | `binary-search`       | 8     | Natural fit, and easy to make genuinely distinct — the search space does not have to be the array.                      |
| 4     | `heap-greedy`         | 8     | Natural fit. A cost or scheduling total over a sequence returns one integer.                                            |
| 5     | `stack-queue`         | 8     | Natural fit, and monotonic-stack problems are rich enough to avoid repeating the sliding-window record.                 |

**Leave these until the wrapper question is settled** — `trees-bst` (12),
`graphs` (12), `backtracking-trie-bit` (8) and `linked-list` (7). Each needs a
structure flattened into one integer array, and the flattening shows through the
statement no matter how carefully it is worded: a level-order tree with
sentinels, or an edge list as pairs, is our plumbing described to the solver.
`linked-list` is the worst of the four, because a linked list flattened into an
integer array simply _is_ an array, and the pattern the topic names does not
survive the encoding. These four deserve a wrapper that takes structured input
(§2), not a clever encoding.

### The rule: distinct from all nine, not just from the one replaced

It is easy to replace a skin with something that differs from _it_ while
duplicating a different group. The bar is higher:

**A new record must not share its underlying computation with any other record
in the library.** Not its test cases, and not the question underneath them.
Different prose over the same computation is what D27 is about, and doing it by
hand is no better than doing it with a script.

Concretely, before you write the statement:

1. **Read the other nine.** One per group is enough — they are all skins.
2. **Name the computation in one sentence**, ignoring the story. "Longest run
   whose spread is within a limit" and "smallest spread over fixed-width runs"
   are different. "Count pairs summing to a target" and "count pairs whose
   difference is a target" are the same problem with a sign changed — do not
   ship the second while the first is in the library.
3. **Check the answer shape.** Two records that both reduce an array to a count
   of qualifying pairs are close enough to be worth rethinking even when the
   predicate differs.
4. **After writing, re-run the command above.** Your record must appear as a
   group of size 1. If it joined an existing group, its test cases match
   something already there and it is a skin, whatever the prose says.

The distinctness check is mechanical and cheap; the judgement in step 2 is not,
and it is the one that matters. A group of size 1 proves the test cases differ.
It does not prove the problem does.
