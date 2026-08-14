/**
 * Magic-link state inspection — READ ONLY.
 *
 * `/login/verify` needs to tell the user which of four things happened, and
 * each has a different remedy. It can do that because the adapter marks tokens
 * consumed instead of deleting them (D12 #5) — the stock `DELETE … RETURNING`
 * would leave "already used" and "never existed" indistinguishable.
 *
 * This function NEVER consumes. It looks, decides, and lets Auth.js's callback
 * do the actual redemption for a valid token, so single-use stays atomic in one
 * place rather than being split across two code paths.
 */
import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Database } from '@/server/db';
import { authVerificationTokens } from '@/server/db/schema';

export type LinkState = 'valid' | 'expired' | 'used' | 'invalid';

/**
 * Auth.js hashes the token before storing it: `sha256(token + secret)`.
 * Verified in `@auth/core/lib/actions/callback/index.js`:
 *   token: await createHash(`${paramToken}${secret}`)
 */
export function hashLinkToken(token: string, secret: string): string {
  return createHash('sha256').update(`${token}${secret}`).digest('hex');
}

export async function inspectMagicLink(
  db: Database,
  input: { token: string; identifier: string; secret: string; now?: Date },
): Promise<{ state: LinkState; identifier: string }> {
  const now = input.now ?? new Date();
  const identifier = input.identifier.toLowerCase();

  const [row] = await db
    .select({
      expires: authVerificationTokens.expires,
      consumedAt: authVerificationTokens.consumedAt,
    })
    .from(authVerificationTokens)
    .where(
      and(
        eq(authVerificationTokens.identifier, identifier),
        eq(authVerificationTokens.token, hashLinkToken(input.token, input.secret)),
      ),
    )
    .limit(1);

  // No row: never issued, or swept by the 24-hour retention job. Those two are
  // genuinely indistinguishable without retaining tokens forever, which is
  // worse — the accepted residual recorded in the plan.
  if (!row) return { state: 'invalid', identifier };

  // Order matters. A link that was used AND has since expired should read as
  // "used", because that is the thing the person actually did.
  if (row.consumedAt !== null) return { state: 'used', identifier };
  if (row.expires.getTime() <= now.getTime()) return { state: 'expired', identifier };

  return { state: 'valid', identifier };
}
