/**
 * Client-side image preparation: square crop → downscale → WebP.
 *
 * Runs BEFORE the presign request, so the size we declare is the size of the
 * file we are actually going to upload. Preparing after presigning would mean
 * declaring one size and uploading another, which confirm rejects.
 *
 * Canvas, not a cropping library — the spec permits it and a 512×512 centre
 * crop is a handful of lines. Re-encoding also discards EXIF, which is where
 * GPS coordinates live in a phone photo; that is a privacy win we get for free
 * and should not accidentally give up by switching to a passthrough upload.
 */

export const AVATAR_DIMENSION = 512;
export const AVATAR_OUTPUT_TYPE = 'image/webp';
/** Quality chosen so a 512×512 photo lands comfortably under 200KB. */
export const AVATAR_QUALITY = 0.85;

export type PreparedImage = {
  blob: Blob;
  sizeBytes: number;
  contentType: 'image/webp';
  /** Object URL for preview. The caller must revoke it. */
  previewUrl: string;
};

export class ImagePreparationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImagePreparationError';
  }
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new ImagePreparationError('That file could not be read as an image.'));
    };

    image.src = url;
  });
}

/**
 * Centre-crops to a square, scales to at most 512×512, encodes WebP.
 *
 * Never upscales: a 200×200 source stays 200×200 rather than being blown up
 * into a blurry 512.
 */
export async function prepareAvatar(file: File): Promise<PreparedImage> {
  const image = await loadImage(file);

  const side = Math.min(image.naturalWidth, image.naturalHeight);
  if (side === 0) throw new ImagePreparationError('That image has no dimensions.');

  const target = Math.min(side, AVATAR_DIMENSION);

  const canvas = document.createElement('canvas');
  canvas.width = target;
  canvas.height = target;

  const context = canvas.getContext('2d');
  if (!context) throw new ImagePreparationError('Your browser blocked image processing.');

  context.drawImage(
    image,
    // Source rectangle: the centre square.
    (image.naturalWidth - side) / 2,
    (image.naturalHeight - side) / 2,
    side,
    side,
    0,
    0,
    target,
    target,
  );

  const blob = await new Promise<Blob | null>((resolve) => {
    canvas.toBlob(resolve, AVATAR_OUTPUT_TYPE, AVATAR_QUALITY);
  });

  if (!blob) throw new ImagePreparationError('That image could not be converted.');

  return {
    blob,
    sizeBytes: blob.size,
    contentType: AVATAR_OUTPUT_TYPE,
    previewUrl: URL.createObjectURL(blob),
  };
}
