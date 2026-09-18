# Restore drill

The procedure for F4.8 acceptance criterion 5:

> **A restore was actually performed and verified — not merely configured.**

Configuration does not satisfy it. Neither does this document. The criterion is
met only by running the sequence below and recording the output.

> **Run this yourself.** It needs Neon account credentials, which do not live on
> a development machine. Paste the transcript back and the evidence gets
> recorded in `docs/acceptance-status.md`.

---

## What this does, and what it does not

Neon's free tier has **no downloadable backup**. What it has is a six-hour
history window and the ability to materialise a branch from a past moment. The
drill therefore proves that a point-in-time recovery works, which is what the
criterion is actually about.

|                         |                                                                  |
| ----------------------- | ---------------------------------------------------------------- |
| Writes to production    | **One row**, in `audit_logs`. Nothing else.                      |
| Touches production data | No. The restore creates a **new** branch.                        |
| Reversible              | Yes — the marker row is deleted and the branch dropped in step 7 |

### Why not `neon branches restore`

Because it is **in place**. It restores a root branch to an earlier state and
auto-creates a backup branch, but the production branch is modified. That is a
real restore and a real risk, and it is not what this drill needs. Creating a
branch from a past timestamp proves the same capability while only ever reading
production.

### ⏳ The six-hour window

The free tier keeps **six hours** of history. Everything here must happen inside
one sitting, and a timestamp in the transcript stops being usable afterwards —
you cannot re-create the branch tomorrow to check the evidence. **Capture the
output as you go**; it is not reproducible later.

### 💸 Cost

Nothing in this procedure costs money on the free tier, provided step 7 runs.

- A branch consumes part of the **0.5 GB project storage**; this database is
  far smaller than that
- The free tier allows **3 root branches**. A branch created with `--parent` is
  a child, not a root, so it should not consume that quota — but see
  _"If the branch quota is full"_ below
- Compute for a branch is billed in the same free allowance as the parent, and
  an idle branch suspends
- **Leaving the drill branch behind is the only way this costs anything.** Step
  7 is not optional.

---

## 0 · Install the CLI

Not installed on the development machine. Checked: neither `neon` nor `neonctl`
is on PATH.

```bash
npm install -g neonctl
```

```bash
neon --version
```

> Expect a version string. The binary is named `neon`; the package is `neonctl`.

```bash
neon auth
```

> Opens a browser for OAuth. Expect `Authentication successful` and a saved
> credentials path. Nothing here goes in the repository.

```bash
neon projects list
```

> Expect your project with its id. **Copy the project id** — later commands take
> `--project-id`, and passing it explicitly avoids acting on the wrong project
> if you ever have more than one.

---

## 1 · Record the starting state

```bash
neon branches list --project-id <PROJECT_ID>
```

> Expect the production branch, probably `main` or `production`. Note its name
> and how many branches exist — you need this to confirm cleanup in step 8.

---

## 2 · Write the marker row

This is the **only** write to production in the whole drill.

**Where it goes:** `audit_logs`. That table is admin-only, is never shown to a
user, and its `actorId` deliberately has **no foreign key** — the schema comment
explains that a `references(users.id)` would let deleting an admin erase
everything that admin ever did. So a marker needs no real user to exist, and
inserting one distorts nothing.

It is also honest: a restore drill is an auditable operational event, so the row
is true rather than junk.

Connect with the pooled production URL — the same `DATABASE_URL` the app uses:

```bash
psql "$DATABASE_URL"
```

```sql
INSERT INTO audit_logs (actor_id, action, target, diff)
VALUES (
  '00000000-0000-0000-0000-000000000000',
  'ops.restore_drill',
  'f4.8-criterion-5',
  '{"note": "Marker written before the restore point. Proves the branch restored to the intended moment."}'::jsonb
)
RETURNING id, created_at;
```

> Expect one row. **Copy `created_at` exactly** — it is the anchor for the whole
> drill. The all-zeroes `actor_id` is a deliberate sentinel: it is not a real
> user and cannot collide with one.

```sql
SELECT now() AS marker_written_at;
```

> Expect a timestamp a moment after `created_at`. Keep both.

---

## 3 · Wait, then take the restore timestamp

Wait **at least 60 seconds**. The restore point must be unambiguously _after_
the marker was committed, and clock skew between your shell and the database is
not worth arguing with.

```sql
SELECT now() AS restore_point;
```

> **Copy this value.** This is the timestamp you restore to. It must be inside
> the six-hour window, which it trivially is.

```sql
\q
```

---

## 4 · Create the restore branch

Replace `<RESTORE_POINT>` with the value from step 3, in RFC 3339 form
(`2026-09-18T14:03:22Z`).

```bash
neon branches create --project-id <PROJECT_ID> --name restore-drill --parent <RESTORE_POINT>
```

> Expect a new branch named `restore-drill` with its own connection details, and
> the parent shown as the production branch at that timestamp. **Copy the
> connection string it prints** — it is the branch's own, not production's.
>
> Production is untouched. Nothing was written to it by this command.

---

## 5 · Verify — the part that makes this a drill

A branch existing proves nothing. These three checks prove the data is right.

```bash
psql "<RESTORE_BRANCH_CONNECTION_STRING>"
```

### 5a · The marker is present

```sql
SELECT id, action, target, created_at
FROM audit_logs
WHERE action = 'ops.restore_drill' AND target = 'f4.8-criterion-5';
```

> **Expect exactly the row from step 2, with the same id and `created_at`.**
>
> This is the whole drill in one query. It proves the branch was restored to the
> intended moment rather than to some arbitrary earlier state — an empty result
> would mean the restore point predated the marker, and the drill would have to
> be repeated with a later timestamp.

### 5b · The rest of the data came back

```sql
SELECT
  (SELECT count(*) FROM users)      AS users,
  (SELECT count(*) FROM problems)   AS problems,
  (SELECT count(*) FROM companies)  AS companies,
  (SELECT count(*) FROM audit_logs) AS audit_logs;
```

> Keep this output. Compare it against 5c below.

### 5c · The same counts on production

In a **second** terminal, so you do not lose the branch session:

```bash
psql "$DATABASE_URL" -c "SELECT (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM problems) AS problems, (SELECT count(*) FROM companies) AS companies, (SELECT count(*) FROM audit_logs) AS audit_logs;"
```

> **Expect the counts to match 5b.** They should, because nothing has written to
> production since the restore point.
>
> If production is higher, something wrote to it during the drill — note what,
> because it means the drill ran against a moving target rather than that the
> restore failed.

### 5d · The schema arrived, not just the rows

```sql
SELECT count(*) AS tables FROM information_schema.tables WHERE table_schema = 'public';
```

> Expect the same count as production. Run the same query on production to
> compare. A restore that brings rows but not constraints is not a restore.

```sql
\q
```

---

## 6 · Capture the evidence

Keep, from the transcript:

1. The marker row's `id` and `created_at` (step 2)
2. The restore point (step 3)
3. The branch-create output (step 4)
4. The marker found on the branch (5a) — **the verification**
5. Matching counts, branch vs production (5b, 5c)
6. Matching table counts (5d)
7. Cleanup confirmation (steps 7 and 8)

Paste it back. It gets recorded in `docs/acceptance-status.md` against criterion
5, with the date, and this file stays as the repeatable procedure.

---

## 7 · Clean up — not optional

### 7a · Delete the branch

```bash
neon branches delete --project-id <PROJECT_ID> restore-drill
```

> Expect a confirmation. This is what stops the drill costing storage.

### 7b · Remove the marker row from production

```bash
psql "$DATABASE_URL"
```

```sql
DELETE FROM audit_logs
WHERE action = 'ops.restore_drill' AND target = 'f4.8-criterion-5'
RETURNING id;
```

> Expect exactly the one id from step 2. If it returns more than one, a previous
> drill left a row behind — that is harmless, but say so in the transcript.
>
> Leaving it is also defensible: it is a true audit entry. Deleting it keeps
> production exactly as it was found, which is the stricter choice.

```sql
\q
```

---

## 8 · Confirm production is as you found it

```bash
neon branches list --project-id <PROJECT_ID>
```

> Expect the same branches as step 1. No `restore-drill`.

```bash
psql "$DATABASE_URL" -c "SELECT count(*) AS drill_markers FROM audit_logs WHERE action = 'ops.restore_drill';"
```

> Expect `0`.

---

## If the branch quota is full

The free tier allows **3 root branches**. A branch created with `--parent` is a
child of production, so it should not count against that limit — but if step 4
fails with a quota error:

```bash
neon branches list --project-id <PROJECT_ID>
```

> Look for branches you do not recognise. Two produce themselves without anyone
> asking:
>
> - **Backup branches** named like `main_old_<timestamp>`, created automatically
>   by a previous `neon branches restore`
> - **Leftover drill branches** from an interrupted run of this procedure

Delete only branches you are certain are disposable:

```bash
neon branches delete --project-id <PROJECT_ID> <BRANCH_NAME>
```

> **Never delete the production branch**, and never delete a branch you cannot
> account for. If every branch is accounted for and the quota is still full,
> stop and say so — the drill is not worth deleting something you are unsure
> about. That is a better outcome than a green checkbox.

---

## If something goes wrong

**Step 4 fails.** Nothing has happened to production except the marker row. Run
step 7b and stop.

**5a returns no rows.** The restore point was before the marker. Delete the
branch (7a) and repeat from step 3 with a later timestamp. Do **not** write a
second marker — the first one is still there.

**Counts differ in 5b/5c.** Do not treat this as a failed restore without
checking whether something wrote to production during the drill. A deployment,
a cron job, or your own browser session are all likelier causes.

**You lose the transcript.** Repeat the drill. The six-hour window means the
evidence cannot be reconstructed after the fact, and a reconstructed transcript
would be a fabrication rather than a record.
