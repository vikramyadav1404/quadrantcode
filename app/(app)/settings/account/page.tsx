/**
 * /settings/account — the ways you can get into this account.
 *
 * One page that answers "how do I sign in, and what happens if I lose one of
 * these". Email is listed even though it cannot be removed, because a list of
 * credentials that omits the primary one is misleading about what the account
 * has.
 */
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isFeatureEnabled } from '@/lib/flags';
import { getDb } from '@/server/db';
import { getServerEnv } from '@/server/env';
import { listConnections } from '@/server/services/auth/connections';
import { getCurrentUser } from '@/server/services/auth/session';
import { ProviderRow } from './ProviderRow';

export default async function AccountSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?returnTo=/settings/account');

  const env = getServerEnv();
  const githubConfigured = Boolean(env.GITHUB_ID && env.GITHUB_SECRET);
  const phoneEnabled = isFeatureEnabled('FEATURE_PHONE_OTP');

  const connections = await listConnections(getDb(), user.id);
  const github = connections.find((entry) => entry.provider === 'github');

  return (
    <div className="flex max-w-2xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-[var(--text-muted)]">
          How you sign in. You can always sign in with an email link, so removing anything else
          here cannot lock you out.
        </p>
      </div>

      <ul className="flex flex-col divide-y divide-[var(--border)] rounded-[var(--radius)] border border-[var(--border)]">
        {/*
          Email first, and without a button. It is not a credential you can
          detach — it IS the account (`users.email` is NOT NULL), and rendering
          a disabled "Disconnect" beside it would imply otherwise.
        */}
        <li className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Email</p>
            <p className="text-sm text-[var(--text-muted)]">{user.email}</p>
          </div>
          <span className="text-sm text-[var(--text-muted)]">Primary — always available</span>
        </li>

        {githubConfigured ? (
          <ProviderRow
            connected={github?.connected ?? false}
            connectedAt={github?.connectedAt?.toISOString() ?? null}
            provider="github"
            title="GitHub"
          />
        ) : (
          /*
           * Shown rather than hidden, because "GitHub is missing from this
           * page" and "GitHub is not set up on this deployment" look identical
           * to a user and only one of them is worth telling them about.
           */
          <li className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div>
              <p className="font-medium">GitHub</p>
              <p className="text-sm text-[var(--text-muted)]">
                Not available on this deployment.
              </p>
            </div>
          </li>
        )}

        <li className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div>
            <p className="font-medium">Phone</p>
            <p className="text-sm text-[var(--text-muted)]">
              {user.verificationLevel >= 1
                ? phoneEnabled
                  ? 'Verified — you can sign in with it.'
                  : 'Verified.'
                : 'Not verified.'}
            </p>
          </div>
          <Link className="text-sm underline" href="/settings/phone">
            {user.verificationLevel >= 1 ? 'Manage' : 'Verify a number'}
          </Link>
        </li>
      </ul>
    </div>
  );
}
