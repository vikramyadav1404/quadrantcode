import type { Metadata } from 'next';
import { LegalPage } from '@/components/public/LegalPage';
import { getPublicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Privacy', alternates: { canonical: '/privacy' } };

export default function PrivacyPage() {
  const support = getPublicEnv().NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <LegalPage
      title="Privacy"
      intro="What Quadrantcode stores, why it is needed, and the controls available to you."
    >
      <section>
        <h2>Data we process</h2>
        <p>
          We store account identifiers, profile choices, problem metadata and links,
          solve-session events, reflections, revision state, and security/audit events. We do
          not store problem statements or test cases from external coding platforms.
        </p>
      </section>
      <section>
        <h2>How it is used</h2>
        <p>
          Your data powers sign-in, session history, analytics, mistake patterns, revisions,
          abuse prevention, and support. It is not sold. The only part that can reach an AI
          provider is an AI hint you ask for — see Service providers below.
        </p>
      </section>
      <section>
        <h2>Service providers</h2>
        <p>
          Depending on enabled features, processing may involve the hosting and database
          provider, Resend for email, GitHub for OAuth, MSG91 for SMS, Upstash for rate limits,
          S3-compatible avatar storage, Judge0 for code execution, and Sentry for error
          monitoring.
        </p>
        <p>
          AI hints, when offered, use Google Gemini. Only when you press Hint, the problem
          statement and your current code are sent to Google for that one hint. On Gemini&apos;s
          free tier Google may use these requests to improve its products. Nothing else — not
          your account, history or other code — is sent, and nothing is sent if you never ask
          for a hint.
        </p>
      </section>
      <section>
        <h2>Retention and control</h2>
        <p>
          You can export practice data and delete your account from Settings. Operational
          backups and security logs may remain for a limited recovery or abuse-prevention
          period. Code snapshots follow the retention control shown in the product.
        </p>
      </section>
      <section>
        <h2>Questions</h2>
        <p>
          {support ? (
            <>
              Email <a href={`mailto:${support}`}>{support}</a>.
            </>
          ) : (
            'A public privacy mailbox will be published before launch.'
          )}
        </p>
      </section>
    </LegalPage>
  );
}
