/**
 * Application-facing database entrypoint.
 *
 * Adds the build-time client-bundle guard on top of `./client`. A Client
 * Component importing `@/server/db` fails the Next build here, even if someone
 * disables the ESLint rule; `tests/boundary/server-boundary.test.ts` covers the
 * lint half.
 *
 * The worker imports `@/server/db/client` instead — see that file for why.
 */
import 'server-only';

export { getDb, closeDb, schema, type Database, type Transaction } from './client';
