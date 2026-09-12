# Privacy

_What Quadrantcode records, how long it keeps it, and how to get rid of it._

This document describes **what the code actually does**, not an intended policy.
Where the two differ — and in one place they do — the difference is stated.

---

## What is recorded

| Data                                   | Why                                      | Where                                    |
| -------------------------------------- | ---------------------------------------- | ---------------------------------------- |
| Email address                          | To sign you in                           | `users`                                  |
| Phone number, if you verify one        | A higher trust tier                      | `verification_methods`, hashed code only |
| Which problems you solved, and when    | Streak, analytics, revision scheduling   | `solve_sessions`, `daily_sessions`       |
| A timeline of each session             | The solve timeline, and stuck inference  | `session_events`                         |
| Snapshots of your code                 | So you can see how a solution took shape | `code_snapshots`                         |
| Your own reflections and stuck markers | Mistake memory, weak-topic scoring       | `reflections`, `stuck_points`            |
| Admin actions, if you are an admin     | Accountability                           | `audit_logs`                             |

**Nothing is shared with anyone. Nothing is used to train anything.** There is
no analytics vendor, no third-party script, and no AI in this build — F3.4 is
cut, and a test greps the inference and summariser modules to keep it that way.

---

## How long it is kept

| Data            | Retention              | Enforced by                         |
| --------------- | ---------------------- | ----------------------------------- |
| Code snapshots  | 90 days                | `npm run snapshots:purge`           |
| Timeline events | As long as the session | Nothing purges them                 |
| Logs            | 30 days                | The hosting platform, not this code |
| Audit logs      | Indefinitely           | Deliberately — see below            |

### The honest caveat about the 90 days

**Nothing schedules `snapshots:purge`.** F2.3 (the queue runtime) is cut, so
every background job in this project is on-demand. Ninety days is the retention
window the code implements; whether it is honoured depends on somebody running
the command.

The settings page says this in plain language rather than promising automatic
deletion, and the delete button below is what erases immediately and reliably.

### Audit logs are kept indefinitely, on purpose

`audit_logs` records what administrators did to other people's data. It refuses
UPDATE and DELETE at the database level and has no purge path — an audit trail
that the powerful can erase is not an audit trail.

---

## What you can turn off

**Code capture**, at `/settings/privacy`. Turning it off stops new snapshots
immediately. Code already saved stays until you delete it.

It defaults to ON, unlike public profiles which default to OFF. The difference
is deliberate: a public profile shows your data to other people, while a
snapshot shows your own history back to you and is the entire input to the
timeline, stuck inference and mistake memory. What makes an on-by-default
honest is this page existing and saying so.

---

## What you can delete

**"Delete my solve history"**, at `/settings/privacy`. It erases every code
snapshot and every timeline entry, for every session, immediately and
permanently.

**It does not delete your sessions.** Removing those would silently rewrite your
streak, your analytics and your revision schedule — a much larger deletion than
the one being asked for. The button says which, and the confirmation afterwards
reports exactly how many rows went.

---

## What is NOT implemented

Stated rather than omitted, because a privacy policy that is quiet about a gap
is worse than one that names it.

- **Full account deletion** is not built. You can delete your solve history; you
  cannot yet delete your account and everything attached to it in one action.
- **Data export** is partial. `npm run` / `/settings/import` exports your tracked
  problem list as CSV. It does not export your sessions, snapshots, reflections
  or timeline.
- **Email delivery is blocked**, so in practice nobody can sign in and none of
  the above has ever applied to a real person's data.

Both gaps belong to a future ticket. Neither is a claim this document makes and
then quietly fails to keep.
