/**
 * One id, followed from an HTTP request through a service into a job.
 *
 * ## `AsyncLocalStorage`, not a parameter threaded everywhere
 *
 * The criterion is that a single `request_id` be traceable across all three
 * layers. The alternative — passing it down every signature — would touch every
 * service in this codebase and would be forgotten the first time somebody adds
 * a function. Node's async context follows the await chain by itself, which is
 * exactly the shape of the problem.
 *
 * The cost is real and worth naming: context is invisible in a signature, so a
 * reader cannot tell from `runExecutionJob(db, provider, id)` that a request id
 * is in scope. That is why `currentRequestId()` returns `null` rather than
 * throwing — code that runs outside a request is normal here (scripts, sweeps),
 * not an error.
 *
 * ## The job case is the one that matters
 *
 * F2.3 is cut, so "a job" means the in-process runner: `setImmediate` inside a
 * request. Async context survives that, so a run enqueued by a request carries
 * that request's id — which is what makes an execution traceable back to the
 * click that started it.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import { REQUEST_ID_HEADER, resolveRequestId } from './request-id';

/*
 * Re-exported, not re-declared. They live in `request-id.ts` because middleware
 * runs on the Edge runtime and cannot load `node:async_hooks` — see that file.
 */
export { REQUEST_ID_HEADER, resolveRequestId };

export type RequestContext = {
  requestId: string;
  /** By ID only. Never an email — see `redact.ts`. */
  userId: string | null;
};

const storage = new AsyncLocalStorage<RequestContext>();

/** Run `fn` with a request context in scope, for it and everything it awaits. */
export function withRequestContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

/** The current request's id, or null outside a request. */
export function currentRequestId(): string | null {
  return storage.getStore()?.requestId ?? null;
}

export function currentUserId(): string | null {
  return storage.getStore()?.userId ?? null;
}

export function currentContext(): RequestContext | null {
  return storage.getStore() ?? null;
}

/**
 * Attach a user to the context already in scope.
 *
 * A request knows its id before it knows who is making it — authentication
 * happens inside the handler. Rather than open a second context, this fills in
 * the field on the existing one, so log lines written before and after
 * authentication share a request id.
 */
export function setContextUser(userId: string): void {
  const store = storage.getStore();
  if (store) store.userId = userId;
}
