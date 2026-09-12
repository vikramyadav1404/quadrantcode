# jobs/

**Empty, and staying that way.** F2.3 (`job-runtime`) is cut from the target
scope, so there is no BullMQ and no queue processors.

Background work runs in-process behind the `JobRunner` seam in
`server/services/ingest/jobs.ts`, with all state in Postgres. See **D17** for
what that costs and how recovery works without a queue.
