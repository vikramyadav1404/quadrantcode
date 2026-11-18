# Beta testing

A short guide to hand to the first few testers, and what to do with what they
find.

## Inviting a tester

Send them <https://quadrantcode.vikramyadav.me> and this page's "For testers"
section. Sign-in is GitHub or an emailed link; nothing to install.

## For testers

Twenty minutes is enough. Please try, in any order:

1. **Sign in and onboard** — pick a goal and a target role.
2. **Solve one original problem** — Problems → any problem with a number. Run your
   code, then Submit. Mark it solved and set your confidence.
3. **Take a mock OA** — Mock OA → any paper. You do not have to finish; start it,
   try one question, and see that the timer and scoring make sense.
4. **Sync Codeforces** (if you have an account) — Settings → Import & export.
5. **Check Revision** next day — the problem you solved should come back.

Then tell us what broke, what confused you and what you would want next:
**Settings → Send feedback**, which opens a GitHub issue form. It is public, so
keep personal details out of it.

## For the maintainer

- Feedback arrives as GitHub issues labelled `beta-feedback`.
- Fix breakages first; collect requests and decide on them weekly.
- The uptime workflow and the daily database backup run regardless — check the
  Actions tab after any report of lost data before touching anything.
