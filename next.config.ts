import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Fail the production build on type or lint errors rather than shipping them.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },

  // `postgres` (postgres.js) and BullMQ are Node-only; keep them out of any
  // edge/client bundle attempt.
  serverExternalPackages: ['postgres'],

  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
