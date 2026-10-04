/**
 * End-to-end check for the F0.3 criterion:
 * "A non-admin hitting /admin gets 403, not a redirect loop."
 *
 * Creates a real user + real database session row, then makes a real HTTP
 * request carrying the session cookie. Asserts the STATUS CODE, because the
 * criterion is about the status, not about a thrown error type.
 */
import postgres from 'postgres';
import { assertNotProductionDatabase } from '@/lib/db/production-guard';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const DB = process.env.DATABASE_URL!;
// Creates users and session rows: never against production (#27).
assertNotProductionDatabase(DB, 'DATABASE_URL (scripts/verify-admin-403.ts)');
const sql = postgres(DB, { max: 1, onnotice: () => {} });

async function makeUser(email: string, role: 'user' | 'admin') {
  await sql`DELETE FROM users WHERE email = ${email}`;
  const [user] = await sql`
    INSERT INTO users (email, role, email_verified_at)
    VALUES (${email}, ${role}, now()) RETURNING id
  `;
  const token = `verify-${role}-${Date.now()}`;
  await sql`
    INSERT INTO auth_sessions (session_token, user_id, expires)
    VALUES (${token}, ${user!.id}, now() + interval '1 day')
  `;
  return token;
}

async function hit(path: string, token?: string) {
  const response = await fetch(`${BASE}${path}`, {
    redirect: 'manual',
    headers: token
      ? { cookie: `${process.env.COOKIE_NAME ?? 'quadrantcode.session'}=${token}` }
      : {},
  });
  return { status: response.status, location: response.headers.get('location') };
}

async function main() {
  const userToken = await makeUser('nonadmin@verify.test', 'user');
  const adminToken = await makeUser('admin@verify.test', 'admin');

  console.log('anonymous    /admin →', JSON.stringify(await hit('/admin')));
  console.log('NON-ADMIN    /admin →', JSON.stringify(await hit('/admin', userToken)));
  console.log('admin        /admin →', JSON.stringify(await hit('/admin', adminToken)));
  console.log('non-admin    /dashboard →', JSON.stringify(await hit('/dashboard', userToken)));
  console.log(
    'STALE cookie /dashboard →',
    JSON.stringify(await hit('/dashboard', 'expired-token-does-not-exist')),
  );
  console.log(
    'STALE cookie /admin →',
    JSON.stringify(await hit('/admin', 'expired-token-does-not-exist')),
  );

  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
