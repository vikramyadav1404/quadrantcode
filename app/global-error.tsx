'use client';

import { useEffect } from 'react';
import { captureException } from '@/lib/monitoring/sentry-client';

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    captureException(error, { tags: { boundary: 'root' } });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main style={{ margin: '0 auto', maxWidth: 560, padding: '20vh 24px' }}>
          <h1>Quadrantcode could not load</h1>
          <p>Please refresh the page. If it keeps happening, contact support.</p>
          {error.digest ? <p>Reference: {error.digest}</p> : null}
        </main>
      </body>
    </html>
  );
}
