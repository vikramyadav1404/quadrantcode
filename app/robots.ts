import type { MetadataRoute } from 'next';
import { getPublicEnv } from '@/lib/env';

export default function robots(): MetadataRoute.Robots {
  const origin = getPublicEnv().NEXT_PUBLIC_APP_URL;
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/admin/', '/api/', '/dashboard/', '/settings/'],
      },
    ],
    sitemap: `${origin}/sitemap.xml`,
  };
}
