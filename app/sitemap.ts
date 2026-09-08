import type { MetadataRoute } from 'next';
import { getPublicEnv } from '@/lib/env';

export default function sitemap(): MetadataRoute.Sitemap {
  const origin = getPublicEnv().NEXT_PUBLIC_APP_URL;
  const lastModified = new Date('2026-08-31T00:00:00.000Z');
  return ['', '/privacy', '/terms', '/security', '/contact'].map((path) => ({
    url: `${origin}${path}`,
    lastModified,
    changeFrequency: path === '' ? 'weekly' : 'monthly',
    priority: path === '' ? 1 : 0.4,
  }));
}
