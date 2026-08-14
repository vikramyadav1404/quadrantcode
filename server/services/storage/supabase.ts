/**
 * Supabase Storage implementation of StorageProvider.
 *
 * Uses the REST API directly rather than `@supabase/supabase-js`: the client
 * library pulls in auth, realtime and postgrest for what is four HTTP calls,
 * and this project already has its own auth. Fewer dependencies on the server
 * bundle, and the wire format is stable and documented.
 *
 * BUCKET POLICY (see README): a DEDICATED `avatars` bucket, public-read.
 * Supabase makes buckets public or private per BUCKET, not per prefix — there
 * is no prefix-level ACL — so "public-read for the avatars prefix only" means
 * a bucket that contains nothing but avatars. Do not put anything else in it.
 *
 * NOT VERIFIED against a live bucket: this project has no Supabase credentials.
 * Everything above the provider seam is tested against `memory.ts`; this file
 * is the part that needs a real bucket before it can be trusted, and
 * docs/acceptance-status.md records that.
 */
import type { PresignedUpload, StorageProvider, StoredObject } from './provider';
import { StorageError } from './provider';

export type SupabaseStorageConfig = {
  /** Project URL, e.g. https://abcdefgh.supabase.co */
  url: string;
  /** SERVICE ROLE key. Server-side only — never NEXT_PUBLIC. */
  serviceKey: string;
  bucket: string;
  fetchImpl?: typeof fetch;
};

export function createSupabaseStorage(config: SupabaseStorageConfig): StorageProvider {
  const doFetch = config.fetchImpl ?? fetch;
  const base = config.url.replace(/\/$/, '');
  const auth = { Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey };

  return {
    name: 'supabase',

    async createPresignedUpload({ key, expiresInSeconds }) {
      const response = await doFetch(
        `${base}/storage/v1/object/upload/sign/${config.bucket}/${key}`,
        {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: expiresInSeconds }),
        },
      );

      if (!response.ok) {
        throw new StorageError(`presign failed: ${response.status}`);
      }

      const body = (await response.json()) as { url?: string };
      if (!body.url) throw new StorageError('presign returned no url');

      return {
        // Supabase returns a path; the browser PUTs to the absolute form.
        uploadUrl: `${base}/storage/v1${body.url}`,
        key,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      } satisfies PresignedUpload;
    },

    async head(key) {
      const response = await doFetch(`${base}/storage/v1/object/info/${config.bucket}/${key}`, {
        headers: auth,
      });

      if (response.status === 404) return null;
      if (!response.ok) throw new StorageError(`head failed: ${response.status}`);

      const body = (await response.json()) as {
        size?: number;
        contentType?: string;
        created_at?: string;
      };

      return {
        key,
        size: body.size ?? 0,
        contentType: body.contentType ?? 'application/octet-stream',
        createdAt: body.created_at ? new Date(body.created_at) : new Date(),
      } satisfies StoredObject;
    },

    async readPrefix(key, byteCount) {
      // A Range request, so a 2MB object is not pulled into the function to
      // read twelve bytes.
      const response = await doFetch(
        `${base}/storage/v1/object/authenticated/${config.bucket}/${key}`,
        { headers: { ...auth, Range: `bytes=0-${byteCount - 1}` } },
      );

      if (response.status === 404) return null;
      if (!response.ok && response.status !== 206) {
        throw new StorageError(`readPrefix failed: ${response.status}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    },

    async remove(key) {
      const response = await doFetch(`${base}/storage/v1/object/${config.bucket}/${key}`, {
        method: 'DELETE',
        headers: auth,
      });

      // 404 is success for a delete — the desired end state already holds.
      if (!response.ok && response.status !== 404) {
        throw new StorageError(`remove failed: ${response.status}`);
      }
    },

    async list(prefix) {
      const response = await doFetch(`${base}/storage/v1/object/list/${config.bucket}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, sortBy: { column: 'created_at' } }),
      });

      if (!response.ok) throw new StorageError(`list failed: ${response.status}`);

      const rows = (await response.json()) as Array<{
        name: string;
        created_at?: string;
        metadata?: { size?: number; mimetype?: string };
      }>;

      return rows.map((row) => ({
        key: `${prefix}${row.name}`,
        size: row.metadata?.size ?? 0,
        contentType: row.metadata?.mimetype ?? 'application/octet-stream',
        createdAt: row.created_at ? new Date(row.created_at) : new Date(),
      }));
    },

    publicUrl(key) {
      return `${base}/storage/v1/object/public/${config.bucket}/${key}`;
    },
  };
}
