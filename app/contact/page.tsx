import type { Metadata } from 'next';
import { LegalPage } from '@/components/public/LegalPage';
import { getPublicEnv } from '@/lib/env';

export const metadata: Metadata = { title: 'Contact', alternates: { canonical: '/contact' } };

export default function ContactPage() {
  const support = getPublicEnv().NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <LegalPage
      title="Contact"
      intro="Account help, privacy requests, and responsible security reports."
    >
      <section>
        <h2>Support</h2>
        <p>
          {support ? (
            <>
              Email <a href={`mailto:${support}`}>{support}</a> and include the request
              reference shown on any error page.
            </>
          ) : (
            'The support mailbox must be configured before production launch.'
          )}
        </p>
      </section>
      <section>
        <h2>Privacy requests</h2>
        <p>
          Account export and deletion are available in Settings. If you cannot sign in, contact
          support from the email associated with the account.
        </p>
      </section>
      <section>
        <h2>Response expectations</h2>
        <p>
          Do not send passwords, OTPs, OAuth secrets, API keys, or full database URLs.
          Acknowledgement times depend on severity and current support capacity.
        </p>
      </section>
    </LegalPage>
  );
}
