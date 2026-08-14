/**
 * Storage provider selection.
 *
 * S3-compatible (Cloudflare R2) rather than Supabase Storage — see
 * docs/decisions.md D11. Supabase's `createSignedUploadUrl` accepts no expiry
 * parameter, so the 60-second presign window is unenforceable there.
 *
 * Chosen by whether credentials exist, matching the OTP provider. Production
 * without credentials fails loudly at boot rather than silently writing
 * avatars into a process that forgets them on restart.
 */
import type { ServerEnv } from '@/server/env';
import { createMemoryStorage } from './memory';
import type { StorageProvider } from './provider';
import { createS3Storage } from './s3';

let devFallback: StorageProvider | undefined;

export function resolveStorage(env: ServerEnv): StorageProvider {
  if (env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY && env.S3_BUCKET) {
    return createS3Storage({
      endpoint: env.S3_ENDPOINT,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
      bucket: env.S3_BUCKET,
      publicBaseUrl: env.S3_PUBLIC_BASE_URL ?? env.S3_ENDPOINT,
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY and S3_BUCKET are required in ' +
        'production. The in-memory storage provider keeps objects in process memory and ' +
        'loses every avatar on restart.',
    );
  }

  // One shared instance so an avatar uploaded in dev survives between requests.
  devFallback ??= createMemoryStorage();
  return devFallback;
}

export * from './provider';
export { createMemoryStorage } from './memory';
export { createS3Storage } from './s3';
