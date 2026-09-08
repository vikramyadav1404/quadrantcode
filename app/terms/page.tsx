import type { Metadata } from 'next';
import { LegalPage } from '@/components/public/LegalPage';

export const metadata: Metadata = { title: 'Terms', alternates: { canonical: '/terms' } };

export default function TermsPage() {
  return (
    <LegalPage title="Terms" intro="The basic rules for using Quadrantcode responsibly.">
      <section>
        <h2>Your account</h2>
        <p>
          Keep access to your email, GitHub account, and verified phone secure. You are
          responsible for activity performed through your session and must provide accurate
          account information.
        </p>
      </section>
      <section>
        <h2>Acceptable use</h2>
        <p>
          Do not probe other accounts, evade limits, disrupt the service, upload malicious
          content, or use code execution to attack third parties. Automated access requires
          prior written permission.
        </p>
      </section>
      <section>
        <h2>External platforms</h2>
        <p>
          Quadrantcode stores metadata and links for external problems and is not affiliated
          with or endorsed by those platforms. Their own terms continue to apply when you follow
          a link.
        </p>
      </section>
      <section>
        <h2>Availability</h2>
        <p>
          The service may change or be suspended for maintenance, security, or provider outages.
          Practice insights are informational and no interview or employment outcome is
          guaranteed.
        </p>
      </section>
      <section>
        <h2>Termination</h2>
        <p>
          You may delete your account from Settings. Access may be restricted for abuse, legal
          requirements, or material violation of these terms.
        </p>
      </section>
    </LegalPage>
  );
}
