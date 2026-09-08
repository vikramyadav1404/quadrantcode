# Native platform manual QA

Run this checklist against a preview deployment with production-shaped
configuration. Use only disposable test accounts and content.

## User workflow

- [ ] At 375 px and 1440 px, `/problems` can filter by difficulty and topic
      without horizontal overflow.
- [ ] A published native problem shows story, contract, examples, constraints,
      hints, company label and all five languages.
- [ ] Editorial and submissions tabs are keyboard reachable.
- [ ] Run executes visible/custom cases and reports compiler/runtime details.
- [ ] Submit executes all cases and records the attempt/progress once.
- [ ] No hidden input, expected output, wrapper or trusted reference appears in
      HTML, React payload, browser network responses, logs or execution-job rows.
- [ ] Compile error, runtime error, wrong answer, timeout, provider outage and
      output-cap states use clear non-misleading copy.

## Company and assessment workflow

- [ ] Company filters work for role, round, year, difficulty and evidence.
- [ ] `company_pattern` is explicitly described as original practice, not PYQ.
- [ ] A candidate report remains invisible until moderator approval/publication.
- [ ] Two reports cannot produce `frequently_reported`; three independent
      moderated reports can.
- [ ] A published mock says pattern-based and unaffiliated, starts a timed
      attempt, restores progress, auto-submits at expiry and shows scoring.

## Admin workflow

- [ ] A normal user receives 403 for every admin page and admin API.
- [ ] Creating/editing native content invalidates prior provider validation.
- [ ] Preview never includes hidden tests, wrappers or reference solutions.
- [ ] Publish fails until originality, editorial, constraints, language,
      coverage, evidence and current real-Judge0 validation are confirmed.
- [ ] Official/verified evidence without a reviewable source is rejected.
- [ ] A paper outside 3–8 questions or not totaling 100 marks is rejected.
- [ ] Public export contains no hidden/reference/wrapper bytes; sensitive export
      requires the explicit confirmation token and creates an audit record.
- [ ] Published/archived content and papers with attempts cannot be silently
      rewritten.

## Provider and operations

- [ ] Judge0 `/languages` resolves C11, C++17, Java, Python 3 and JavaScript.
- [ ] CPU, wall, memory, output and disabled-network limits are observed on the
      deployed Judge0 instance.
- [ ] All imported problems are validated through the real provider before any
      production publication.
- [ ] Health/readiness, audit events, rate limits, backup/restore and rollback
      have been tested using `docs/deployment.md` and `docs/launch-checklist.md`.
