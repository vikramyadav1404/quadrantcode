# Restore drill

The procedure for F4.8 acceptance criterion 5:

> **A restore was actually performed and verified — not merely configured.**

Configuration does not satisfy it. Neither does this document. The criterion is
met only by running the sequence below and recording the output.

---

## ✅ Performed 18 September 2026

Neon project `holy-field-88722670`, region `aws-ap-southeast-1`.

|                     |                                                                               |
| ------------------- | ----------------------------------------------------------------------------- |
| Marker id           | `c566a574-c8a1-45e9-a44b-49f5b0478959`                                        |
| Marker written      | `2026-09-18T17:19:48.615Z`                                                    |
| Restore point       | `2026-09-18T17:21:35.656Z` (1m 47s after the marker)                          |
| Branch created with | `--parent 2026-09-18T17:21:35Z`                                               |
| Restore branch      | `restore-drill` · `br-dark-rain-b34vmvam` · endpoint `ep-still-boat-b3d3qjh5` |

**On the restore branch** — `ep-still-boat-b3d3qjh5-pooler…`, via `DRILL_URL`:

```
marker rows   1
  id c566a574-c8a1-45e9-a44b-49f5b0478959  created_at 2026-09-18T17:19:48.615Z
users 1  problems 30  companies 0  audit_logs 1
tables 48
```

**On production** — `ep-winter-term-b3ibi9et-pooler…`, via `NEON_DATABASE_URL`:

```
marker rows   1
  id c566a574-c8a1-45e9-a44b-49f5b0478959  created_at 2026-09-18T17:19:48.615Z
users 1  problems 30  companies 0  audit_logs 1
tables 48
```

Then `neon branches delete restore-drill`, and `neon branches list` returned the
default `production` branch (`br-weathered-sunset-b3sajlh1`) alone.

**What makes this a verification rather than a branch that appeared.** The marker
id matches to the millisecond on both sides, so the branch came back to the
intended moment rather than some arbitrary earlier state. `audit_logs` reads 1
against a pre-drill baseline of 0, so the marker is the only write. `tables 48`
on both sides means the schema restored, not only the rows. And the two host
lines differ — `ep-still-boat` against `ep-winter-term` — which is what
distinguishes two real queries from one database queried twice.

Baseline before the drill: `users 1 · problems 30 · companies 0 · audit_logs 0 ·
tables 48`.

The marker row remains in production, permanently, as the audit record that this
happened.

> **Run this yourself.** It needs Neon credentials, which do not live on a
> development machine. Keep the transcript; it is the evidence.

---

## What this does, and what it does not

Neon's free tier has **no downloadable backup**. What it has is a six-hour
history window and the ability to materialise a branch from a past moment. The
drill therefore proves point-in-time recovery works, which is what the criterion
is actually about.

|                         |                                                                        |
| ----------------------- | ---------------------------------------------------------------------- |
| Writes to production    | **One row**, in `audit_logs`. Nothing else.                            |
| Touches production data | No. The restore creates a **new** branch.                              |
| Reversible              | The branch is dropped in step 6. **The marker row is not** — see below |

### The marker row is permanent, and that is correct

`audit_logs` is append-only **at the database**. Trigger
`audit_logs_append_only` refuses UPDATE and DELETE, and unlike `session_events`
there is no purge escape hatch. Migration 0019 says why:

> _An audit log exists precisely so that the people with power over other
> people's data cannot quietly erase what they did — a purge flag would hand
> them the eraser._

So the marker cannot be removed, and this procedure has no cleanup step for it.
That is the right outcome rather than a compromise: a restore drill **is** a real
operational event, an audit log is where a permanent record of one belongs, and
the row carries no user data.

> An earlier draft of this document instructed the operator to `DELETE` the
> marker in a cleanup step. The database refuses that, and it would have been
> discovered mid-drill with the marker already written.

### ⏳ The six-hour window

The free tier keeps **six hours** of history. Everything here must happen in one
sitting, and a timestamp in the transcript stops being usable afterwards — you
cannot re-create the branch tomorrow to check the evidence. **Capture output as
you go**; it is not reproducible later.

### 💸 Cost

Nothing here costs money on the free tier, provided step 6 runs.

- A branch consumes part of the **0.5 GB project storage**; this database is far
  smaller than that
- The free tier allows **3 root branches**. A branch created with `--parent` is a
  child, not a root, so it should not consume that quota — but see _"If the
  branch quota is full"_
- **Leaving the drill branch behind is the only way this costs anything.** Step 6
  is not optional.

---

## 0 · Prerequisites

`psql` is **not** required. The helper uses the `postgres` driver the project
already depends on.

```powershell
npm install -g neonctl
```

```powershell
neon --version
```

> A version string. The binary is `neon`; the package is `neonctl`.

```powershell
neon auth
```

> Opens a browser. **You have 60 seconds** — have the browser ready before you
> press enter. Expect `Authentication successful`.
>
> Run this in your own terminal. The token belongs in your local Neon config.

```powershell
neon projects list
```

> **Copy the project id.** Every later `neon` command takes it explicitly, so you
> cannot act on the wrong project by accident.

### Point the helper at Neon

```powershell
$env:NEON_DATABASE_URL = "<neon pooled connection string>"
```

> No output. Set this in your own terminal — the connection string is a
> credential. The helper prints only the host, never the string.
>
> **`DATABASE_URL` is deliberately ignored.** In this repo it points at the local
> embedded test instance. An earlier version of the helper fell back to it and
> wrote a marker to `localhost:55432`; the transcript looked correct and proved
> nothing. The helper now refuses any host that is not `*.neon.tech`.

---

## 1 · Baseline, before anything is written

```powershell
neon branches list --project-id <PROJECT_ID>
```

> The production branch, probably `main` or `production`. **Note how many
> branches exist** — you compare against this in step 7.

```powershell
npm run drill -- verify
```

> Confirms `connected to <something>.neon.tech via NEON_DATABASE_URL
(production)`, then `marker rows 0` and the current row and table counts.
>
> **Check the host line before going further.** This is the last step before a
> permanent write, and the only one that confirms you are pointed at Neon.

---

## 2 · The marker row — the only write to production

```powershell
npm run drill -- marker
```

> ```
> marker id     <uuid>
> created_at    2026-09-18T…Z
> db clock now  2026-09-18T…Z
>
> This row is PERMANENT — audit_logs refuses DELETE.
> ```
>
> **Copy the marker id and `created_at`.** One row in `audit_logs`, admin-only,
> with an all-zeroes sentinel `actor_id` that cannot collide with a real user.

---

## 3 · Wait 60 seconds, then take the restore point

The restore point must be unambiguously _after_ the marker committed, and clock
skew between your shell and the database is not worth arguing with.

```powershell
npm run drill -- now
```

> ```
> RESTORE POINT 2026-09-18T…Z
> ```
>
> **Copy this exactly.** Already RFC 3339 and ready to paste.

---

## 4 · Create the restore branch

```powershell
neon branches create --project-id <PROJECT_ID> --name restore-drill --parent <RESTORE_POINT>
```

> A new branch and its own connection string. **Copy that connection string.**
>
> Production is untouched: this command only read it. Note this is
> `branches create`, **not** `branches restore` — the latter restores a root
> branch _in place_, which modifies production even though it auto-creates a
> backup branch.

---

## 5 · Verify — the step that makes this a drill

```powershell
$env:DRILL_URL = "<restore branch connection string>"
```

```powershell
npm run drill -- verify
```

> Confirms `via DRILL_URL (restore branch)`, then:
>
> ```
> marker rows   1
>   id <uuid>  created_at 2026-09-18T…Z
> users N  problems N  companies N  audit_logs N
> tables N
> ```
>
> **The marker id must match step 2.** This is the whole drill in one result: it
> proves the branch restored to the _intended_ moment rather than some arbitrary
> earlier state.
>
> `marker rows 0` means the restore point predated the marker. Delete the branch
> (step 6), and repeat from step 3 with a later timestamp. **Do not write a
> second marker** — the first is still there, permanently.

```powershell
Remove-Item Env:\DRILL_URL
```

```powershell
npm run drill -- verify
```

> Back on production. **Counts and table count should match the branch.** They
> should, because nothing has written to production since the restore point.
>
> If production is higher, something wrote to it during the drill — note what.
> That means the drill ran against a moving target, not that the restore failed.
>
> A matching **table** count matters separately: a restore that brings rows but
> not constraints is not a restore.

---

## 6 · Delete the branch — not optional

```powershell
neon branches delete --project-id <PROJECT_ID> restore-drill
```

> A confirmation. This is what stops the drill costing storage.

---

## 7 · Confirm production is as you found it

```powershell
neon branches list --project-id <PROJECT_ID>
```

> The same branches as step 1. No `restore-drill`.

```powershell
npm run drill -- verify
```

> `marker rows 1` — the permanent record that the drill happened. Everything else
> unchanged from step 1.

---

## 8 · Record the evidence

Keep, from the transcript:

1. The marker id and `created_at` (step 2)
2. The restore point (step 3)
3. The branch-create output (step 4)
4. **The marker found on the branch, with a matching id (step 5)** — the
   verification
5. Matching counts and table counts, branch versus production (step 5)
6. Branch deletion (step 6) and the final branch list (step 7)

That goes into `docs/acceptance-status.md` against criterion 5, with the date.

---

## If the branch quota is full

```powershell
neon branches list --project-id <PROJECT_ID>
```

> Look for branches you do not recognise. Two appear without anyone asking:
>
> - **Backup branches** named like `main_old_<timestamp>`, created automatically
>   by a previous `neon branches restore`
> - **Leftover drill branches** from an interrupted run of this procedure

```powershell
neon branches delete --project-id <PROJECT_ID> <BRANCH_NAME>
```

> **Never delete the production branch**, and never delete one you cannot account
> for. If everything is accounted for and the quota is still full, stop and say
> so. An unexplained branch you deleted is worse than an unticked checkbox.

---

## If something goes wrong

**Step 4 fails.** Nothing has happened to production except the marker row, which
stays. Stop.

**Step 5 shows `marker rows 0`.** The restore point was before the marker. Delete
the branch and repeat from step 3 with a later timestamp. Do not write a second
marker.

**Counts differ between branch and production.** Check whether something wrote to
production during the drill before concluding the restore failed. A deployment, a
cron job, or your own browser session are all likelier causes.

**You lose the transcript.** Repeat the drill — it will leave a second marker
row, which is honest. The six-hour window means evidence cannot be reconstructed
afterwards, and a reconstructed transcript would be a fabrication rather than a
record.
