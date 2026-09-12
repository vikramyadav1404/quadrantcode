import type { Metadata } from 'next';
import { LegalPage } from '@/components/public/LegalPage';
import { getPublicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Security', alternates: { canonical: '/security' } };

export default function SecurityPage() {
  const support = getPublicEnv().NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <LegalPage title="Security" intro="How Quadrantcode protects account and practice data.">
      <section>
        <h2>Controls</h2>
        <p>
          Passwordless sign-in uses short-lived, single-use tokens; sessions are HTTP-only,
          secure in production, revocable, and rotated. Sensitive endpoints use distributed rate
          limits and validated inputs.
        </p>
      </section>
      <section>
        <h2>Data boundaries</h2>
        <p>
          Secrets stay server-side, database access is scoped by the authenticated user, uploads
          are size/type checked, and arbitrary code is sent only to the configured isolated
          execution provider with explicit limits.
        </p>
      </section>
      <section>
        <h2>Report a vulnerability</h2>
        <p>
          Please avoid accessing other users’ data.{' '}
          {support ? (
            <>
              Send a concise report to{' '}
              <a href={`mailto:${support}?subject=Security%20report`}>{support}</a>.
            </>
          ) : (
            'A security mailbox will be published before launch.'
          )}
        </p>
      </section>
    </LegalPage>
  );
}
