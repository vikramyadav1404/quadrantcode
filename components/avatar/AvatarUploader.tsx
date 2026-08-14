'use client';

/**
 * Three-step upload: prepare → presign → PUT → confirm.
 *
 * The PUT goes straight to storage from the browser. Nothing here posts the
 * file to our own server.
 *
 * Note what this component does NOT do: it never decides whether a file is
 * acceptable. It re-encodes to WebP, which happens to normalise most bad
 * input, and then the server checks the bytes. Client-side validation here is
 * a courtesy that saves a round trip, never a gate.
 */
import { useRef, useState } from 'react';
import { Avatar, type AvatarAppearanceProps } from './Avatar';
import { ImagePreparationError, prepareAvatar } from './prepare-image';

type Status = 'idle' | 'preparing' | 'uploading' | 'confirming';

export function AvatarUploader({
  initialUrl,
  appearance,
  onChange,
}: {
  initialUrl: string | null;
  appearance: AvatarAppearanceProps;
  onChange?: (url: string | null) => void;
}) {
  const [url, setUrl] = useState(initialUrl);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<string | null>(null);

  const busy = status !== 'idle';

  function releasePreview() {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
  }

  async function handleFile(file: File) {
    setError(null);

    try {
      setStatus('preparing');
      // Prepared FIRST, so the declared size is the size actually uploaded.
      const prepared = await prepareAvatar(file);

      releasePreview();
      previewRef.current = prepared.previewUrl;
      setUrl(prepared.previewUrl);

      setStatus('uploading');
      const presignResponse = await fetch('/api/avatar/presign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contentType: prepared.contentType,
          sizeBytes: prepared.sizeBytes,
        }),
      });

      const presigned = (await presignResponse.json()) as {
        ok: boolean;
        uploadUrl?: string;
        key?: string;
        message?: string;
      };

      if (!presigned.ok || !presigned.uploadUrl || !presigned.key) {
        throw new Error(presigned.message ?? 'Could not start the upload.');
      }

      // DIRECT to storage. The file never touches a route handler.
      const put = await fetch(presigned.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': prepared.contentType },
        body: prepared.blob,
      });
      if (!put.ok) throw new Error('The upload did not complete. Try again.');

      setStatus('confirming');
      const confirmResponse = await fetch('/api/avatar/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: presigned.key, sizeBytes: prepared.sizeBytes }),
      });

      const confirmed = (await confirmResponse.json()) as {
        ok: boolean;
        avatarUrl?: string;
        message?: string;
      };

      if (!confirmed.ok || !confirmed.avatarUrl) {
        throw new Error(confirmed.message ?? 'That image was rejected.');
      }

      releasePreview();
      setUrl(confirmed.avatarUrl);
      onChange?.(confirmed.avatarUrl);
    } catch (caught) {
      // Roll the preview back to whatever was actually saved.
      releasePreview();
      setUrl(initialUrl);
      setError(
        caught instanceof ImagePreparationError || caught instanceof Error
          ? caught.message
          : 'Something went wrong.',
      );
    } finally {
      setStatus('idle');
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleRemove() {
    setError(null);
    setStatus('confirming');
    try {
      const response = await fetch('/api/avatar/confirm', { method: 'DELETE' });
      if (!response.ok) throw new Error('Could not remove the avatar.');
      releasePreview();
      setUrl(null);
      onChange?.(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setStatus('idle');
    }
  }

  const label =
    status === 'preparing'
      ? 'Preparing…'
      : status === 'uploading'
        ? 'Uploading…'
        : status === 'confirming'
          ? 'Finishing…'
          : url
            ? 'Change photo'
            : 'Upload photo';

  return (
    <div className="flex items-center gap-4">
      <Avatar alt="Your avatar" appearance={appearance} size={64} src={url} />

      <div className="flex flex-col gap-2">
        <input
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          id="avatar-input"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleFile(file);
          }}
          ref={inputRef}
          type="file"
        />

        <div className="flex gap-2">
          <label
            className="cursor-pointer rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm"
            htmlFor="avatar-input"
          >
            {label}
          </label>

          {url ? (
            <button
              className="rounded-[var(--radius)] border border-[var(--border)] px-3 py-2 text-sm text-[var(--text-muted)] disabled:opacity-60"
              disabled={busy}
              onClick={() => void handleRemove()}
              type="button"
            >
              Remove
            </button>
          ) : null}
        </div>

        <p className="text-xs text-[var(--text-muted)]">
          JPEG, PNG or WebP, up to 2MB. Cropped to a square and resized to 512px.
        </p>

        {error ? (
          <p aria-live="polite" className="text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    </div>
  );
}
