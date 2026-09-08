import type { Metadata } from 'next';
import { getPublicEnv } from '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(getPublicEnv().NEXT_PUBLIC_APP_URL),
  applicationName: 'Quadrantcode',
  title: { default: 'Quadrantcode · Practice with intent', template: '%s · Quadrantcode' },
  description:
    'Track solve time, stuck points, mistakes and revisions — not just whether you solved it.',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Quadrantcode',
    title: 'Quadrantcode · Practice with intent',
    description: 'Turn every coding session into clear next steps.',
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Quadrantcode · Practice with intent',
    description: 'Turn every coding session into clear next steps.',
  },
  robots: { index: true, follow: true },
};

/**
 * Applies the stored theme before first paint so there is no flash of the
 * wrong theme. Dark is the default, so the script only acts on an explicit
 * light preference.
 */
const THEME_BOOTSTRAP = `
(function(){try{var t=localStorage.getItem('traceloop-theme');
if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
