/**
 * Object storage behind an interface.
 *
 * The service layer never imports a vendor SDK, so swapping Supabase Storage
 * for Cloudflare R2 is a new file implementing this contract — not a refactor
 * of the avatar pipeline.
 *
 * It also makes the pipeline TESTABLE without credentials: `memory.ts` is a
 * faithful in-memory implementation, and every rule that matters (magic bytes,
 * size caps, cross-user prefixes, replace-deletes-old, orphan cleanup) is
 * verified against it. Only the actual signing and network transfer need a
 * real bucket.
 */

export type StoredObject = {
  key: string;
  size: number;
  contentType: string;
  createdAt: Date;
};

export type PresignedUpload = {
  /** Absolute URL the browser PUTs to. Never proxied through our server. */
  uploadUrl: string;
  key: string;
  expiresAt: Date;
};

export type StorageProvider = {
  readonly name: string;

  /**
   * Issues a short-lived upload URL for `key`.
   * The caller has already validated the key, size and declared type — the
   * provider does not re-check policy, it only signs.
   */
  createPresignedUpload(input: {
    key: string;
    contentType: string;
    maxBytes: number;
    expiresInSeconds: number;
  }): Promise<PresignedUpload>;

  /** Metadata for an uploaded object, or null when it does not exist. */
  head(key: string): Promise<StoredObject | null>;

  /**
   * First `byteCount` bytes of the object.
   *
   * Used for magic-number validation. Reading a prefix rather than the whole
   * object matters: a 2MB file does not need to be pulled into a serverless
   * function to check four bytes.
   */
  readPrefix(key: string, byteCount: number): Promise<Uint8Array | null>;

  /** Deletes an object. Succeeds silently when the key is already gone. */
  remove(key: string): Promise<void>;

  /** Lists keys under a prefix. Used by the orphan-cleanup job. */
  list(prefix: string): Promise<StoredObject[]>;

  /**
   * PUBLIC read URL for a key.
   *
   * Constructed here, server-side, from the key alone. The client never sends
   * a URL — accepting one would let an attacker point `avatar_url` at any
   * origin, which is both an SSRF vector for anything that later fetches it
   * and a content-injection hole in every page that renders it.
   */
  publicUrl(key: string): string;
};

export class StorageError extends Error {
  readonly code = 'STORAGE_ERROR' as const;
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'StorageError';
  }
}
