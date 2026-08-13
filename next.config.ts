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
    // Enables `forbidden()` / `unauthorized()`, which render a real 403/401
    // instead of redirecting. F0.3 requires a non-admin hitting /admin to get
    // 403 rather than a redirect loop back through sign-in.
    authInterrupts: true,
  },
};

export default nextConfig;
