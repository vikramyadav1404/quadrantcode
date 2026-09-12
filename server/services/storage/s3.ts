/**
 * S3-compatible StorageProvider — Cloudflare R2 in production.
 *
 * WHY NOT SUPABASE STORAGE (see docs/decisions.md D11):
 * `createSignedUploadUrl(path, options?: { upsert })` takes NO expiry
 * parameter, and its request body is literally `{}`. Upload-URL validity is
 * fixed server-side and cannot be set by the caller — only DOWNLOAD URLs
 * (`createSignedUrl(path, expiresIn, …)`) accept one. The F0.5 criterion "a
 * presigned URL is unusable 90 seconds after issue" is therefore unsatisfiable
 * on Supabase, and the in-memory fake implementing a faithful 60-second expiry
 * was MORE capable than the real provider — a green suite proving nothing.
 *
 * S3 SigV4 presigning puts `X-Amz-Expires` inside the signature, so the expiry
 * is caller-controlled and enforced by any conformant implementation. R2 is
 * S3-compatible, so this file works against R2, MinIO or S3 unchanged.
 *
 * Range reads are likewise part of the S3 protocol (`GetObject` with `Range`),
 * so the magic-byte check reads twelve bytes rather than downloading 2MB.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { PresignedUpload, StorageProvider, StoredObject } from './provider';
import { StorageError } from './provider';

export type S3StorageConfig = {
  /** R2: https://<account-id>.r2.cloudflarestorage.com */
  endpoint: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Public base URL for the bucket's public-read prefix — an R2 custom domain
   * or r2.dev subdomain. Kept separate from `endpoint` because the signing
   * host and the public host are different origins.
   */
  publicBaseUrl: string;
};

export function createS3Storage(config: S3StorageConfig): StorageProvider {
  const client = new S3Client({
    // R2 ignores region but the SDK requires one.
    region: config.region ?? 'auto',
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    // R2 requires path-style addressing.
    forcePathStyle: true,
  });

  const publicBase = config.publicBaseUrl.replace(/\/$/, '');

  return {
    name: 's3',

    async createPresignedUpload({ key, contentType, expiresInSeconds }) {
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: key,
          ContentType: contentType,
        }),
        // THE reason this provider exists: caller-controlled expiry, signed in.
        { expiresIn: expiresInSeconds },
      );

      return {
        uploadUrl: url,
        key,
        expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
      } satisfies PresignedUpload;
    },

    async head(key) {
      try {
        const result = await client.send(
          new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
        );

        return {
          key,
          size: result.ContentLength ?? 0,
          contentType: result.ContentType ?? 'application/octet-stream',
          createdAt: result.LastModified ?? new Date(),
        } satisfies StoredObject;
      } catch (error) {
        if (isNotFound(error)) return null;
        throw new StorageError('head failed', error);
      }
    },

    async readPrefix(key, byteCount) {
      try {
        const result = await client.send(
          new GetObjectCommand({
            Bucket: config.bucket,
            Key: key,
            // Protocol-level ranged read: twelve bytes, not two megabytes.
            Range: `bytes=0-${byteCount - 1}`,
          }),
        );

        if (!result.Body) return null;
        return new Uint8Array(await result.Body.transformToByteArray());
      } catch (error) {
        if (isNotFound(error)) return null;
        throw new StorageError('readPrefix failed', error);
      }
    },

    async remove(key) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
      } catch (error) {
        // A missing object is the desired end state already.
        if (isNotFound(error)) return;
        throw new StorageError('remove failed', error);
      }
    },

    async list(prefix) {
      try {
        const result = await client.send(
          new ListObjectsV2Command({ Bucket: config.bucket, Prefix: prefix, MaxKeys: 1000 }),
        );

        return (result.Contents ?? []).map((object) => ({
          key: object.Key ?? '',
          size: object.Size ?? 0,
          contentType: 'application/octet-stream',
          createdAt: object.LastModified ?? new Date(),
        }));
      } catch (error) {
        throw new StorageError('list failed', error);
      }
    },

    publicUrl(key) {
      return `${publicBase}/${key}`;
    },
  };
}

/** S3 signals a missing key several ways depending on the operation. */
function isNotFound(error: unknown): boolean {
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    candidate?.name === 'NotFound' ||
    candidate?.name === 'NoSuchKey' ||
    candidate?.$metadata?.httpStatusCode === 404
  );
}
