/**
 * Does the REAL provider hold the contract the fake implements?
 *
 * The review finding that produced this file: an in-memory fake can easily be
 * MORE capable than the vendor it stands in for, and then a green suite proves
 * nothing about production. Supabase Storage turned out to be exactly that case
 * — see docs/decisions.md D11.
 *
 * Two tiers here:
 *
 *  1. ALWAYS RUNS — protocol-level assertions needing no account. SigV4 signs
 *     `X-Amz-Expires` INTO the presigned URL, so caller-controlled expiry can
 *     be proven by reading the URL the SDK produces. Any conformant S3
 *     implementation rejects it after that window; that is the protocol, not a
 *     vendor promise.
 *  2. STORAGE_INTEGRATION=1 — the live round trip against a real bucket:
 *     presign, direct PUT, ranged magic-byte read, expiry, cross-user
 *     rejection.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createS3Storage } from '@/server/services/storage/s3';
import {
  MAGIC_PREFIX_BYTES,
  avatarKey,
  confirmAvatarUpload,
  detectImageType,
  presignAvatarUpload,
} from '@/server/services/profile';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const PNG_HEADER = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d,
]);

function pngOf(totalBytes: number): Uint8Array {
  const bytes = new Uint8Array(totalBytes);
  bytes.set(PNG_HEADER);
  return bytes;
}

/** fetch() wants a BodyInit; a Uint8Array view needs its backing buffer. */
function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

/** Signing needs credentials but NOT a reachable endpoint — it is local maths. */
const offlineStorage = createS3Storage({
  endpoint: 'https://account.r2.cloudflarestorage.com',
  accessKeyId: 'AKIAOFFLINETESTKEY',
  secretAccessKey: 'offline-secret-not-a-real-credential',
  bucket: 'avatars',
  publicBaseUrl: 'https://cdn.example.test',
});

describe('S3 presigning holds the expiry contract (no account needed)', () => {
  it('signs the CALLER-SUPPLIED expiry into the URL', async () => {
    const presigned = await offlineStorage.createPresignedUpload({
      key: 'avatars/u/f.png',
      contentType: 'image/png',
      maxBytes: 2 * 1024 * 1024,
      expiresInSeconds: 60,
    });

    const url = new URL(presigned.uploadUrl);

    // This single assertion is what Supabase could not satisfy: the requested
    // 60 seconds appears in the signed query string.
    expect(url.searchParams.get('X-Amz-Expires')).toBe('60');
    expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
    expect(url.searchParams.get('X-Amz-Algorithm')).toBe('AWS4-HMAC-SHA256');
  });

  it('a different expiry produces a different signed URL', async () => {
    // Proves the value is genuinely part of the signature rather than a
    // decorative query parameter a server might ignore.
    const short = await offlineStorage.createPresignedUpload({
      key: 'avatars/u/f.png',
      contentType: 'image/png',
      maxBytes: 1024,
      expiresInSeconds: 60,
    });
    const long = await offlineStorage.createPresignedUpload({
      key: 'avatars/u/f.png',
      contentType: 'image/png',
      maxBytes: 1024,
      expiresInSeconds: 7200,
    });

    expect(new URL(short.uploadUrl).searchParams.get('X-Amz-Expires')).toBe('60');
    expect(new URL(long.uploadUrl).searchParams.get('X-Amz-Expires')).toBe('7200');
    expect(new URL(short.uploadUrl).searchParams.get('X-Amz-Signature')).not.toBe(
      new URL(long.uploadUrl).searchParams.get('X-Amz-Signature'),
    );
  });

  it('reports an expiresAt matching the requested window', async () => {
    const before = Date.now();
    const presigned = await offlineStorage.createPresignedUpload({
      key: 'avatars/u/f.png',
      contentType: 'image/png',
      maxBytes: 1024,
      expiresInSeconds: 60,
    });

    expect(presigned.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59_000);
    expect(presigned.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
  });

  it('builds the public URL from the key and the public host, not the signing host', () => {
    const url = offlineStorage.publicUrl('avatars/u/f.png');
    expect(url).toBe('https://cdn.example.test/avatars/u/f.png');
    // The signing endpoint carries credentials in its URLs; it must never be
    // the origin handed to a browser.
    expect(url).not.toContain('r2.cloudflarestorage.com');
  });
});

// ── Tier 2: live bucket ─────────────────────────────────────────────────────

const liveConfigured =
  process.env.STORAGE_INTEGRATION === '1' &&
  Boolean(process.env.S3_ENDPOINT) &&
  Boolean(process.env.S3_ACCESS_KEY_ID) &&
  Boolean(process.env.S3_SECRET_ACCESS_KEY) &&
  Boolean(process.env.S3_BUCKET);

const liveSuite = liveConfigured && hasTestDatabase ? describe : describe.skip;

liveSuite('LIVE bucket round trip (STORAGE_INTEGRATION=1)', () => {
  let ctx: TestContext;
  let storage: ReturnType<typeof createS3Storage>;
  const created: string[] = [];

  beforeAll(async () => {
    ctx = await setupTestDb();
    storage = createS3Storage({
      endpoint: process.env.S3_ENDPOINT!,
      accessKeyId: process.env.S3_ACCESS_KEY_ID!,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      bucket: process.env.S3_BUCKET!,
      publicBaseUrl: process.env.S3_PUBLIC_BASE_URL ?? process.env.S3_ENDPOINT!,
    });
  }, 60_000);

  afterAll(async () => {
    // Leave no test objects behind in a real bucket.
    for (const key of created) await storage.remove(key).catch(() => {});
    await ctx?.close();
  });

  it('presign → direct PUT → head reports the real size', async () => {
    await truncateAll(ctx.sql);
    const user = await createUser(ctx.db);
    const bytes = pngOf(4096);

    const presigned = await presignAvatarUpload({ db: ctx.db, storage }, user.id, {
      contentType: 'image/png',
      sizeBytes: bytes.byteLength,
    });
    created.push(presigned.key);

    const put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: body(bytes),
    });
    expect(put.ok, `PUT failed: ${put.status}`).toBe(true);

    const object = await storage.head(presigned.key);
    expect(object?.size).toBe(4096);
  }, 60_000);

  it('readPrefix performs a RANGED read, not a full download', async () => {
    const user = await createUser(ctx.db, { email: 'range@example.com' });
    const bytes = pngOf(512 * 1024);

    const presigned = await presignAvatarUpload({ db: ctx.db, storage }, user.id, {
      contentType: 'image/png',
      sizeBytes: bytes.byteLength,
    });
    created.push(presigned.key);

    await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: body(bytes),
    });

    const prefix = await storage.readPrefix(presigned.key, MAGIC_PREFIX_BYTES);

    // The decisive assertion: we asked for 12 bytes of a 512KB object and got
    // 12 bytes. A provider without Range support returns the whole object.
    expect(prefix?.byteLength).toBe(MAGIC_PREFIX_BYTES);
    expect(detectImageType(prefix!)).toBe('image/png');
  }, 60_000);

  it('confirm accepts a real image uploaded through the real flow', async () => {
    const user = await createUser(ctx.db, { email: 'confirm@example.com' });
    const bytes = pngOf(2048);

    const presigned = await presignAvatarUpload({ db: ctx.db, storage }, user.id, {
      contentType: 'image/png',
      sizeBytes: bytes.byteLength,
    });
    created.push(presigned.key);

    await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: body(bytes),
    });

    const { avatarUrl } = await confirmAvatarUpload({ db: ctx.db, storage }, user.id, {
      key: presigned.key,
      declaredSizeBytes: bytes.byteLength,
    });

    expect(avatarUrl).toContain(presigned.key);
  }, 60_000);

  it('an EXPIRED presigned URL is rejected by the bucket', async () => {
    const user = await createUser(ctx.db, { email: 'expiry@example.com' });

    // One second, then wait it out — the only honest way to test a real
    // signature's expiry, since the clock is the remote server's.
    const presigned = await storage.createPresignedUpload({
      key: avatarKey(user.id, crypto.randomUUID(), 'image/png'),
      contentType: 'image/png',
      maxBytes: 2 * 1024 * 1024,
      expiresInSeconds: 1,
    });

    await new Promise((resolve) => setTimeout(resolve, 3000));

    const put = await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: body(pngOf(1024)),
    });

    expect(put.ok, 'an expired presigned URL must not accept an upload').toBe(false);
    expect(put.status).toBeGreaterThanOrEqual(400);
  }, 60_000);

  it('User A cannot confirm an object under User B’s prefix', async () => {
    const userA = await createUser(ctx.db, { email: 'liveA@example.com' });
    const userB = await createUser(ctx.db, { email: 'liveB@example.com' });
    const bytes = pngOf(1024);

    const presigned = await presignAvatarUpload({ db: ctx.db, storage }, userB.id, {
      contentType: 'image/png',
      sizeBytes: bytes.byteLength,
    });
    created.push(presigned.key);

    await fetch(presigned.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: body(bytes),
    });

    await expect(
      confirmAvatarUpload({ db: ctx.db, storage }, userA.id, {
        key: presigned.key,
        declaredSizeBytes: bytes.byteLength,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_KEY' });

    expect(await storage.head(presigned.key)).not.toBeNull();
  }, 60_000);
});
