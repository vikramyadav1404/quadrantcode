/**
 * Storage provider selection.
 *
 * Chosen by whether credentials exist, matching how the OTP provider decides —
 * a developer who configures a real bucket gets real storage with no code
 * change, and production without credentials fails loudly at boot rather than
 * silently writing avatars into a process that forgets them on restart.
 */
import type { ServerEnv } from '@/server/env';
import { createMemoryStorage } from './memory';
import type { StorageProvider } from './provider';
import { createSupabaseStorage } from './supabase';

let devFallback: StorageProvider | undefined;

export function resolveStorage(env: ServerEnv): StorageProvider {
  if (env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) {
    return createSupabaseStorage({
      url: env.SUPABASE_URL,
      serviceKey: env.SUPABASE_SERVICE_ROLE_KEY,
      bucket: env.SUPABASE_AVATAR_BUCKET ?? 'avatars',
    });
  }

  if (env.NODE_ENV === 'production') {
    throw new Error(
      'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in production. The ' +
        'in-memory storage provider keeps objects in process memory and loses every ' +
        'avatar on restart.',
    );
  }

  // One shared instance so an avatar uploaded in dev survives between requests.
  devFallback ??= createMemoryStorage();
  return devFallback;
}

export * from './provider';
export { createMemoryStorage } from './memory';
export { createSupabaseStorage } from './supabase';
