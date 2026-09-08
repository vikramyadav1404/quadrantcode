# Native practice platform

This document is the implementation and operating guide for Quadrantcode's
original-problem, company-preparation and assessment extension.

## Shipped content

- `data/native-problems/` contains exactly 100 independently authored problem
  records: 35 easy, 45 medium and 20 hard.
- Topic counts are arrays/hashing 15, two pointers 10, binary search 8,
  stack/queue 8, linked list 7, trees/BST 12, heap/greedy 8, graphs 12,
  backtracking/trie/bit 8 and dynamic programming 12.
- Every record contains two examples, an editorial, at least six coverage-tagged
  cases, and C11/C++17/Java/Python 3/JavaScript starter, wrapper and trusted
  reference code.
- `data/assessment-papers.json` contains 20 original pattern-based mocks: two
  each for Amazon, Google, Microsoft, Meta, Adobe, Flipkart, Atlassian, Uber,
  Goldman Sachs and Walmart. Every paper contains 3–8 questions and totals
  exactly 100 marks.

The content is original Quadrantcode practice. It is not copied from another
platform, and `company_pattern` never means official sample or previously
asked question.

## Content commands

```powershell
npm run native:generate
npm run papers:generate
npm run native:validate
npm run papers:validate
npm run native:validate-references
npm run native:import
```

Generation is deterministic. Structural validators enforce counts, uniqueness,
provenance, language completeness, coverage and evidence rules. The reference
validator compiles/runs trusted solutions with installed local toolchains and
compares normalized output. The importer acquires advisory locks, writes
immutable versioned records transactionally and is safe to rerun.

Do not run the generation commands merely to deploy existing checked-in data;
validate and import it. Regeneration is an editorial change and must be reviewed
like any other content change.

## Data and migrations

Migrations 0020–0023 add normalized native content, versions, licenses,
examples, editorials, language templates, coverage-tagged tests, topics,
company evidence, interview reports, assessment papers/attempts/answers and
provider-validation metadata. Forward and reverse SQL are present under
`server/db/migrations` and `server/db/migrations/down`.

Published and archived content is immutable. Editing a draft invalidates its
provider-validation timestamp/hash. The public query layer returns statements,
examples and starter code but never hidden input/output, wrapper templates or
trusted references.

## Review and publishing

1. Import or create content. It starts as `draft` or `needs_review`.
2. Edit the statement, constraints, examples, editorial, five language
   contracts and all test coverage from `/admin/problems/[problemId]`.
3. Use the safe preview. It intentionally omits hidden tests, wrappers and
   references.
4. Send the version for review.
5. With a real `JUDGE0_URL` (and key when required), run external validation.
   All five references must pass every stored test. Runtime/provider/hash
   metadata is persisted.
6. Confirm originality, examples/editorial, constraints, language contracts,
   reference correctness, coverage and evidence, then publish.

The publish service rejects incomplete coverage, missing language data,
unreviewed licensing/evidence or stale/nonexistent provider validation. The
checked-in library intentionally remains `needs_review` until this real-provider
step is completed.

## Execution behavior

Run executes visible/sample cases plus an optional custom case. Submit executes
the complete suite. Each case is sent to Judge0 independently with configured
CPU, wall, memory, network and output limits. Dynamic `/languages` discovery is
used instead of permanent numeric Judge0 IDs.

The browser receives only safe case metadata. Hidden inputs, expected outputs,
actual outputs, wrappers and reference code are neither serialized into the
page nor copied into execution jobs. Submit stores a hidden-case summary, not
the secret bytes. Verified Submit updates attempt history, problem progress,
streak/revision state and assessment scoring server-side.

## Company evidence

- `official_sample` and `verified_pyq` require a reviewable source and moderator
  verification.
- `candidate_reported` is one approved recollection and is not independently
  confirmed.
- `frequently_reported` requires at least three moderated independent reports.
- `company_pattern` is an original preparation association and may have no
  source URL or previous-question claim.
- `unverified` is visible as unverified and cannot silently become a stronger
  claim.

Candidate reports enter moderation before publication. Admin company/evidence
mutations and all publication transitions write audit events.

## Admin transfer safety

The content-transfer admin page validates native JSON, assessment JSON and
evidence CSV with strict row/size limits. Public-safe export omits all hidden
tests, wrappers and trusted references. Sensitive export is admin-only and
requires the explicit `scope=sensitive&confirm=hidden-data` contract. Treat it
as production secret material.

## External requirements

Local verification is complete, but launch still needs managed PostgreSQL,
real authentication/email configuration and a real Judge0 deployment. Judge0
must be checked for supported runtime names, resource-limit enforcement,
disabled networking, outage behavior and output caps. These are deployment
properties and cannot be proven by the local HTTP contract server.
