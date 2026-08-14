/**
 * In-memory StorageProvider.
 *
 * Not a stub — a faithful implementation, including presigned-URL EXPIRY,
 * which is what lets the "unusable after 90 seconds" criterion be tested with
 * an injected clock instead of a 90-second sleep.
 *
 * Every avatar rule above the provider seam is verified against this: magic
 * bytes, size caps at both phases, cross-user prefixes, replace-deletes-old,
 * and orphan cleanup. A real bucket is needed only to prove that Supabase
 * signs and transfers correctly, which is Supabase's job, not ours.
 */
import { randomUUID } from 'node:crypto';
import type { PresignedUpload, StorageProvider, StoredObject } from './provider';

type Upload = {
  key: string;
  contentType: string;
  maxBytes: number;
  expiresAt: Date;
};

export type MemoryStorage = StorageProvider & {
  /** Simulates the browser PUT. Returns false when the URL is expired or unknown. */
  put(uploadUrl: string, bytes: Uint8Array): Promise<boolean>;
  /** Every stored key — for assertions like "exactly one object remains". */
  keys(): string[];
  /** Places an object directly, bypassing presign. Used to seed orphans. */
  seed(key: string, bytes: Uint8Array, createdAt?: Date): void;
  reset(): void;
};

export function createMemoryStorage(options: { now?: () => Date } = {}): MemoryStorage {
  const now = options.now ?? (() => new Date());
  const objects = new Map<string, { bytes: Uint8Array; object: StoredObject }>();
  const uploads = new Map<string, Upload>();

  const BASE = 'https://storage.test';

  return {
    name: 'memory',

    createPresignedUpload({ key, contentType, maxBytes, expiresInSeconds }) {
      const token = randomUUID();
      const expiresAt = new Date(now().getTime() + expiresInSeconds * 1000);
      uploads.set(token, { key, contentType, maxBytes, expiresAt });

      return Promise.resolve({
        uploadUrl: `${BASE}/upload/${token}`,
        key,
        expiresAt,
      } satisfies PresignedUpload);
    },

    put(uploadUrl, bytes) {
      const token = uploadUrl.split('/').pop() ?? '';
      const upload = uploads.get(token);
      if (!upload) return Promise.resolve(false);

      // Expiry is enforced here, exactly as a real signed URL would.
      if (upload.expiresAt.getTime() <= now().getTime()) {
        uploads.delete(token);
        return Promise.resolve(false);
      }

      // A real bucket rejects an over-size body too; the confirm step
      // re-verifies regardless, because this check is the vendor's, not ours.
      if (bytes.byteLength > upload.maxBytes) return Promise.resolve(false);

      objects.set(upload.key, {
        bytes,
        object: {
          key: upload.key,
          size: bytes.byteLength,
          contentType: upload.contentType,
          createdAt: now(),
        },
      });
      uploads.delete(token);
      return Promise.resolve(true);
    },

    head(key) {
      return Promise.resolve(objects.get(key)?.object ?? null);
    },

    readPrefix(key, byteCount) {
      const entry = objects.get(key);
      if (!entry) return Promise.resolve(null);
      return Promise.resolve(entry.bytes.slice(0, byteCount));
    },

    remove(key) {
      objects.delete(key);
      return Promise.resolve();
    },

    list(prefix) {
      return Promise.resolve(
        [...objects.values()]
          .map((entry) => entry.object)
          .filter((object) => object.key.startsWith(prefix)),
      );
    },

    publicUrl(key) {
      return `${BASE}/public/${key}`;
    },

    keys() {
      return [...objects.keys()];
    },

    seed(key, bytes, createdAt) {
      objects.set(key, {
        bytes,
        object: {
          key,
          size: bytes.byteLength,
          contentType: 'application/octet-stream',
          createdAt: createdAt ?? now(),
        },
      });
    },

    reset() {
      objects.clear();
      uploads.clear();
    },
  };
}
