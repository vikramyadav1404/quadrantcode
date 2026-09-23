# C3 · Company associations

**Date:** 2026-09-22 · **Constraint:** C3 — _company references are always
"-style"; never "actual company question"._

This document is the analysis. What was changed in response to it is in the
"What was done" section at the end, and in D31. It is kept because the finding is
easy to re-discover badly: the obvious reading is "the company chip wording is a
bit strong", and the actual problem is that the guard everyone points at does not
cover the chip at all.

---

## Summary

Nothing in production was a false claim. All 104 company associations in the
content library use the weakest evidence type, none carries a source URL, and
`FEATURE_ORIGINAL_PROBLEMS` is false in production so none of it is user-visible.

Three things were nonetheless wrong:

1. **The C3 database guard does not cover company associations.** It constrains a
   different table. `CLAUDE.md` claimed coverage that did not exist.
2. **The solve page rendered a bare company name**, linked to that company's
   page, with no disclaimer anywhere on the route.
3. **Four of six evidence types assert real company provenance**, and only
   convention prevented their use.

The third is the one that would have cost something. A single admin action could
have put **"Verified PYQ"** on a problem, and every structural check in the
codebase would have allowed it.

---

## 1 · The guard is not where the documentation said

`CLAUDE.md`'s "Where the guards are" table listed C3 as enforced by
`problem_tags_company_style_suffix`. That CHECK is real
(`server/db/schema/problems.ts`):

```sql
check (problem_tags_company_style_suffix:
  tag_type <> 'company_style' or tag_value like '%-style')
```

It constrains exactly one thing: rows in `problem_tags` with
`tag_type = 'company_style'`.

**Company associations are not in that table.** They are rows in
`problem_company_evidence`, joined to `companies` by a plain foreign key. There is
no `-style` requirement on that path, no CHECK covering it, and no test asserting
one.

So the documented guard was accurate about itself and misleading about its scope.
That is the more dangerous half of this finding: a stated guard stops people
looking. Someone reading the table would reasonably conclude C3 was handled at
the database level for every company reference, and would have been wrong.

The lesson is the same one as D28 — **state what was measured in the same breath
as the verdict.** A guard table entry should name what the constraint covers, not
just the constraint.

## 2 · What the solve page actually rendered

`components/solve/ProblemPanel.tsx`:

```tsx
<Link href={`/companies/${company.slug}`}>
  {company.name} · {EVIDENCE_TYPE_LABELS[company.evidenceType]}
</Link>
```

Producing **"Amazon · Company pattern"**, hyperlinked to `/companies/amazon`.

Two problems in one line. The name is bare — `Amazon`, not `Amazon-style` — which
is the letter of C3. And it is a link, which reads as a stronger assertion than a
label does: a link implies there is something authoritative on the other end.

### The disclaimer was in all the wrong places

`components/companies/CompanyDisclaimer.tsx` says the right thing:

> Quadrantcode is independent and is not affiliated with or endorsed by any
> listed company. Company names are used descriptively. Pattern-based practice is
> not presented as an official or previously asked question.

It appeared on all five `/companies/*` routes, and **not** on
`/problems/[slug]/solve`.

That is exactly inverted. The `/companies` pages are self-evidently a
company-organised index; a reader arrives already knowing the framing. The solve
page is where a company name gets attached to _one specific problem_, which is
the moment the claim becomes concrete and the moment a reader might take it as
provenance. The strongest wording sat where the weakest claim was made.

## 3 · Four evidence types assert provenance, and nothing forbade them

`lib/native/constants.ts` declares six:

| Type                  | Label               | Asserts a real company link?       |
| --------------------- | ------------------- | ---------------------------------- |
| `official_sample`     | Official sample     | **yes** — published by the company |
| `verified_pyq`        | Verified PYQ        | **yes** — previously asked         |
| `candidate_reported`  | Candidate reported  | **yes** — a candidate saw it       |
| `frequently_reported` | Frequently reported | **yes** — multiple reports         |
| `company_pattern`     | Company pattern     | no — _"not a PYQ claim"_           |
| `unverified`          | Unverified          | no                                 |

Every association in the library is `company_pattern` — 20 active, 84 retired,
104 of 104, none with a `sourceUrl`. The type whose own description disclaims a
PYQ assertion.

**But that was convention, not enforcement.** The column defaults to
`company_pattern` and is freely settable; the admin CRUD in
`server/services/admin/companies.ts` and the CSV import path in
`server/services/admin/content-transfer.ts` both accept any value in the enum.

The two CHECKs that existed on the table are worth reading carefully, because
they look like protection and are not:

```sql
check (problem_company_evidence_verified_source:
  evidence_type not in ('official_sample','verified_pyq')
  or (source_url is not null and verification_status = 'verified'))

check (problem_company_evidence_frequent_threshold:
  evidence_type <> 'frequently_reported' or report_count >= 3)
```

These make a provenance claim **well-formed**. They require a claim of
`verified_pyq` to carry a URL and a verified status — which is a sound rule for a
platform that intends to make such claims after review. They do not, and were
never meant to, prevent the claim from being made. Reading them as a C3 guard is
a mistake this document exists partly to prevent.

There is no review workflow today. So the capability to assert real company
provenance existed with no process behind it.

---

## What was done

Decided with the owner on 2026-09-22:

1. **Drop the link on the solve-page chip.** Plain label, no `/companies` href.
   Links stay on the `/companies` pages themselves, where the framing is already
   established by the disclaimer at the top of each route.
2. **Block the four provenance types with a database CHECK** —
   `evidence_type in ('company_pattern','unverified')`. Block now, unblock when a
   real review workflow exists. Chosen over removing enum members, because
   dropping a `pgEnum` value is a migration with real cost, whereas relaxing a
   CHECK is one line the day it is wanted.
3. **Leave the 104 existing rows untouched.** They are all `company_pattern`,
   which stays legal under the new CHECK. A write with no reader is a write that
   can only go wrong.

Plus: build the chip string through one helper so no call site can interpolate a
bare company name; add the disclaimer to the solve route; correct the `CLAUDE.md`
guard table to name both constraints and what each covers.

### The CHECK needs a positive control, and this is why

The new constraint is a no-op against current data — every existing row already
satisfies it. A test that inserts a `company_pattern` row and sees it succeed
proves nothing about whether the CHECK exists at all.

So the constraint test asserts the _rejection_: inserting `verified_pyq` must
fail. That is the assertion that can distinguish "the CHECK is present" from "the
migration silently did not apply", and it is the shape `CLAUDE.md`'s verification
standard requires for anything phrased as "X cannot happen".

The same applies to the copy rule. A test asserting "every rendered company
string contains `-style`" passes trivially if the function under test returns an
empty list. It is paired with a control that feeds it a bare company name and
requires a failure.

---

## Deliberately not done

- **No change to the six-value enum.** `verified_pyq` and the others remain
  declared. They are blocked, not deleted, so the day a review workflow lands
  the change is dropping one CHECK rather than a data migration.
- **No review workflow.** That is a product decision about whether verified past
  questions are ever intended content, not a C3 fix.
- **No change to the `/companies` routes.** Their disclaimer is already present
  and correctly worded, and their links are appropriate in context.
- **No change to the 84 retired associations.** They are loaded by nothing. See
  D29 for why retired content is not edited in place.
