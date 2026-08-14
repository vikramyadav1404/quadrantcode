/**
 * F0.5 · avatar upload security.
 *
 * Every one of these is an acceptance criterion, and each is verified at the
 * layer the criterion names — the cross-user check hits the SERVICE directly
 * rather than driving the UI, because the UI is not what an attacker uses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { userProfiles } from '@/server/db/schema';
import {
  AvatarError,
  MAX_AVATAR_BYTES,
  avatarKey,
  cleanupOrphanedAvatars,
  confirmAvatarUpload,
  detectImageType,
  keyBelongsTo,
  keyFromPublicUrl,
  ownerOfKey,
  presignAvatarUpload,
  removeAvatar,
} from '@/server/services/profile';
import { type MemoryStorage, createMemoryStorage } from '@/server/services/storage/memory';
import {
  type TestContext,
  createUser,
  hasTestDatabase,
  setupTestDb,
  truncateAll,
} from '../helpers/db';

const suite = hasTestDatabase ? describe : describe.skip;

// ── Real file headers, byte for byte ────────────────────────────────────────
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 0]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]);
const WEBP = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
]);
/** `%PDF-1.4` — the payload the criterion names, renamed to avatar.png. */
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
/** "RIFF" without "WEBP" — a WAV file. Matching only RIFF would accept it. */
const WAV = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
]);

function padded(header: Uint8Array, totalBytes: number): Uint8Array {
  const out = new Uint8Array(totalBytes);
  out.set(header.slice(0, Math.min(header.length, totalBytes)));
  return out;
}

describe('F0.5 · magic-number detection (pure)', () => {
  it.each([
    ['JPEG', JPEG, 'image/jpeg'],
    ['PNG', PNG, 'image/png'],
    ['WebP', WEBP, 'image/webp'],
  ])('identifies %s', (_label, bytes, expected) => {
    expect(detectImageType(bytes)).toBe(expected);
  });

  it.each([
    ['a PDF', PDF],
    ['a GIF (not in the allow-list)', GIF],
    ['a WAV that also starts with RIFF', WAV],
    ['empty bytes', new Uint8Array(0)],
    ['a truncated PNG header', new Uint8Array([0x89, 0x50])],
  ])('rejects %s', (_label, bytes) => {
    expect(detectImageType(bytes)).toBeNull();
  });
});

describe('F0.5 · storage keys (pure)', () => {
  const userA = '11111111-1111-4111-8111-111111111111';
  const userB = '22222222-2222-4222-8222-222222222222';

  it('embeds the user id and a uuid', () => {
    const key = avatarKey(userA, '33333333-3333-4333-8333-333333333333', 'image/png');
    expect(key).toBe(`avatars/${userA}/33333333-3333-4333-8333-333333333333.png`);
    expect(ownerOfKey(key)).toBe(userA);
  });

  it('refuses to attribute another user’s key', () => {
    const key = avatarKey(userB, '33333333-3333-4333-8333-333333333333', 'image/png');
    expect(keyBelongsTo(key, userA)).toBe(false);
    expect(keyBelongsTo(key, userB)).toBe(true);
  });

  it.each([
    'avatars/../../etc/passwd.png',
    'avatars//nested.png',
    `avatars/${'x'.repeat(36)}/file.exe`,
    'not-avatars/uuid/uuid.png',
  ])('rejects the malformed key %s', (key) => {
    expect(ownerOfKey(key)).toBeNull();
    expect(keyBelongsTo(key, userA)).toBe(false);
  });

  it('recovers a key from a public URL, and only a well-formed one', () => {
    const key = avatarKey(userA, '33333333-3333-4333-8333-333333333333', 'image/webp');
    expect(keyFromPublicUrl(`https://storage.test/public/${key}`)).toBe(key);
    expect(keyFromPublicUrl('https://evil.example/whatever.png')).toBeNull();
    expect(keyFromPublicUrl(null)).toBeNull();
  });
});

suite('F0.5 · avatar lifecycle', () => {
  let ctx: TestContext;
  let storage: MemoryStorage;
  let clock: Date;

  const now = () => clock;

  beforeAll(async () => {
    ctx = await setupTestDb();
  }, 60_000);

  afterAll(async () => {
    await ctx?.close();
  });

  beforeEach(async () => {
    await truncateAll(ctx.sql);
    clock = new Date('2026-08-14T10:00:00Z');
    storage = createMemoryStorage({ now });
  });

  const deps = () => ({ db: ctx.db, storage, now });

  async function upload(userId: string, bytes: Uint8Array, declaredType = 'image/png') {
    const presigned = await presignAvatarUpload(deps(), userId, {
      contentType: declaredType,
      sizeBytes: bytes.byteLength,
    });
    const ok = await storage.put(presigned.uploadUrl, bytes);
    return { ...presigned, uploaded: ok };
  }

  it('accepts a real PNG end to end and stores a server-built URL', async () => {
    const user = await createUser(ctx.db);
    const bytes = padded(PNG, 4096);

    const presigned = await upload(user.id, bytes);
    expect(presigned.uploaded).toBe(true);

    const { avatarUrl } = await confirmAvatarUpload(deps(), user.id, {
      key: presigned.key,
      declaredSizeBytes: bytes.byteLength,
    });

    expect(avatarUrl).toContain(presigned.key);

    const [row] = await ctx.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id));
    expect(row?.avatarUrl).toBe(avatarUrl);
  });

  it('REJECTS a PDF renamed avatar.png, and deletes the uploaded object', async () => {
    const user = await createUser(ctx.db);
    const bytes = padded(PDF, 4096);

    // Declared as image/png and named .png — everything lies except the bytes.
    const presigned = await upload(user.id, bytes, 'image/png');
    expect(storage.keys()).toContain(presigned.key);

    await expect(
      confirmAvatarUpload(deps(), user.id, {
        key: presigned.key,
        declaredSizeBytes: bytes.byteLength,
      }),
    ).rejects.toMatchObject({ code: 'NOT_AN_IMAGE' });

    // The criterion says the object must be deleted, not merely unlinked.
    expect(storage.keys()).not.toContain(presigned.key);

    const rows = await ctx.db.select().from(userProfiles);
    expect(rows.filter((row) => row.avatarUrl !== null)).toHaveLength(0);
  });

  it('rejects a 5MB file at PRESIGN, before any upload begins', async () => {
    const user = await createUser(ctx.db);

    await expect(
      presignAvatarUpload(deps(), user.id, {
        contentType: 'image/png',
        sizeBytes: 5 * 1024 * 1024,
      }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });

    // Nothing was signed, so nothing could have been uploaded.
    expect(storage.keys()).toHaveLength(0);
  });

  it('re-verifies the real size at confirm, not just the declaration', async () => {
    const user = await createUser(ctx.db);
    const bytes = padded(PNG, 4096);
    const presigned = await upload(user.id, bytes);

    // Declared 4096 at presign, now claims 100 at confirm.
    await expect(
      confirmAvatarUpload(deps(), user.id, { key: presigned.key, declaredSizeBytes: 100 }),
    ).rejects.toMatchObject({ code: 'SIZE_MISMATCH' });

    expect(storage.keys()).not.toContain(presigned.key);
  });

  it('rejects an unsupported declared type at presign', async () => {
    const user = await createUser(ctx.db);
    await expect(
      presignAvatarUpload(deps(), user.id, { contentType: 'image/gif', sizeBytes: 1024 }),
    ).rejects.toMatchObject({ code: 'UNSUPPORTED_TYPE' });
  });

  it('a presigned URL is unusable 90 seconds after issue', async () => {
    const user = await createUser(ctx.db);
    const bytes = padded(PNG, 1024);

    const presigned = await presignAvatarUpload(deps(), user.id, {
      contentType: 'image/png',
      sizeBytes: bytes.byteLength,
    });

    // Injected clock rather than a real 90-second sleep.
    clock = new Date(clock.getTime() + 90_000);

    expect(await storage.put(presigned.uploadUrl, bytes)).toBe(false);
    expect(storage.keys()).toHaveLength(0);
  });

  it('User A cannot confirm a key under User B’s prefix', async () => {
    const userA = await createUser(ctx.db, { email: 'a@example.com' });
    const userB = await createUser(ctx.db, { email: 'b@example.com' });

    const bytes = padded(PNG, 2048);
    const bUpload = await upload(userB.id, bytes);

    // Straight at the service — not through the UI.
    await expect(
      confirmAvatarUpload(deps(), userA.id, {
        key: bUpload.key,
        declaredSizeBytes: bytes.byteLength,
      }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN_KEY', status: 403 });

    // B's object survives — A's failed attempt must not delete B's avatar.
    expect(storage.keys()).toContain(bUpload.key);
  });

  it('presign always keys off the SESSION user, so a forged id is impossible', async () => {
    const userA = await createUser(ctx.db, { email: 'a2@example.com' });
    const presigned = await presignAvatarUpload(deps(), userA.id, {
      contentType: 'image/png',
      sizeBytes: 1024,
    });

    expect(ownerOfKey(presigned.key)).toBe(userA.id);
  });

  it('replacing an avatar leaves EXACTLY ONE object for that user', async () => {
    const user = await createUser(ctx.db);

    const first = await upload(user.id, padded(PNG, 2048));
    await confirmAvatarUpload(deps(), user.id, {
      key: first.key,
      declaredSizeBytes: 2048,
    });

    const second = await upload(user.id, padded(JPEG, 3072), 'image/jpeg');
    await confirmAvatarUpload(deps(), user.id, {
      key: second.key,
      declaredSizeBytes: 3072,
    });

    const mine = storage.keys().filter((key) => key.includes(user.id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toBe(second.key);
  });

  it('removing an avatar deletes the object and nulls the column', async () => {
    const user = await createUser(ctx.db);
    const uploaded = await upload(user.id, padded(WEBP, 2048), 'image/webp');
    await confirmAvatarUpload(deps(), user.id, {
      key: uploaded.key,
      declaredSizeBytes: 2048,
    });

    await removeAvatar(deps(), user.id);

    expect(storage.keys()).not.toContain(uploaded.key);
    const [row] = await ctx.db
      .select()
      .from(userProfiles)
      .where(eq(userProfiles.userId, user.id));
    expect(row?.avatarUrl).toBeNull();
  });

  it('enforces the 2MB cap as an exact boundary', async () => {
    const user = await createUser(ctx.db);

    await expect(
      presignAvatarUpload(deps(), user.id, {
        contentType: 'image/png',
        sizeBytes: MAX_AVATAR_BYTES + 1,
      }),
    ).rejects.toBeInstanceOf(AvatarError);

    await expect(
      presignAvatarUpload(deps(), user.id, {
        contentType: 'image/png',
        sizeBytes: MAX_AVATAR_BYTES,
      }),
    ).resolves.toBeDefined();
  });

  describe('orphan cleanup', () => {
    it('deletes unconfirmed objects older than 24h, keeps live and recent ones', async () => {
      const user = await createUser(ctx.db);

      // A live avatar, confirmed.
      const live = await upload(user.id, padded(PNG, 1024));
      await confirmAvatarUpload(deps(), user.id, {
        key: live.key,
        declaredSizeBytes: 1024,
      });

      // An old orphan: presigned, uploaded, never confirmed.
      const oldKey = avatarKey(user.id, '44444444-4444-4444-8444-444444444444', 'image/png');
      storage.seed(oldKey, padded(PNG, 512), new Date(clock.getTime() - 48 * 3600 * 1000));

      // A fresh orphan — may be mid-confirm right now, must survive.
      const freshKey = avatarKey(user.id, '55555555-5555-4555-8555-555555555555', 'image/png');
      storage.seed(freshKey, padded(PNG, 512), new Date(clock.getTime() - 60 * 1000));

      const { deleted } = await cleanupOrphanedAvatars(deps());

      expect(deleted).toEqual([oldKey]);
      expect(storage.keys()).toContain(live.key);
      expect(storage.keys()).toContain(freshKey);
      expect(storage.keys()).not.toContain(oldKey);
    });
  });
});
