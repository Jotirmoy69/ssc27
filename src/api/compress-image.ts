const MAX_EDGE = 1920;
const MIN_EDGE = 640;
const MAX_BYTES = 1024 * 1024;
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;
const MAX_ATTEMPTS = 14;

/** MIME types the Worker can store and browsers can display without conversion. */
const DIRECT_STORE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

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
      reject(new Error('Could not read image'));
    };
    image.src = url;
  });
}

async function decodeImage(
  file: File,
): Promise<{ width: number; height: number; draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void; close?: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, {
        imageOrientation: 'from-image',
      } as ImageBitmapOptions);
      return {
        width: bitmap.width,
        height: bitmap.height,
        draw: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        close: () => bitmap.close(),
      };
    } catch {
      // Fall through to HTMLImageElement for formats createImageBitmap rejects.
    }
  }

  const image = await loadImage(file);
  return {
    width: image.width,
    height: image.height,
    draw: (ctx, w, h) => ctx.drawImage(image, 0, 0, w, h),
  };
}

function canvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error('WebP conversion failed'));
          return;
        }
        resolve(blob);
      },
      'image/webp',
      quality,
    );
  });
}

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/heic',
  'image/heif',
]);

/** True for still images only — videos and other types are rejected. */
export function isAllowedImageFile(file: File): boolean {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/')) return false;
  if (type.startsWith('image/')) return IMAGE_TYPES.has(type) || type === 'image/jpg';
  // Some phones omit MIME; fall back to extension.
  const name = file.name.toLowerCase();
  return /\.(jpe?g|png|webp|gif|avif|heic|heif)$/i.test(name);
}

export function assertAllowedImageFile(file: File): void {
  const type = (file.type || '').toLowerCase();
  if (type.startsWith('video/') || /\.(mp4|mov|webm|mkv|avi|m4v)$/i.test(file.name)) {
    throw new Error('Videos are not allowed. Upload a photo instead.');
  }
  if (!isAllowedImageFile(file)) {
    throw new Error('Only image files are allowed (JPEG, PNG, WebP, GIF, AVIF).');
  }
}

function canStoreDirectly(file: File): boolean {
  if (file.size > MAX_SOURCE_BYTES) return false;
  const type = (file.type || '').toLowerCase();
  if (DIRECT_STORE_TYPES.has(type) || type === 'image/jpg') return true;
  // Phones sometimes omit MIME — allow by extension for displayable formats only.
  return /\.(jpe?g|png|webp|gif|avif)$/i.test(file.name);
}

function extensionForBlob(blob: Blob, originalName: string): string {
  const type = (blob.type || '').toLowerCase();
  if (type.includes('webp')) return '.webp';
  if (type.includes('png')) return '.png';
  if (type.includes('gif')) return '.gif';
  if (type.includes('avif')) return '.avif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const match = originalName.match(/(\.[a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : '.jpg';
}

export type PreparedUpload = {
  blob: Blob;
  /** Safe filename including extension for the Worker. */
  filename: string;
  compressed: boolean;
};

/**
 * Prefer WebP <=1MB. If compression can't meet that, store the original
 * (JPEG/PNG/WebP/GIF/AVIF up to 20MB) so the upload still succeeds.
 */
export async function prepareImageForUpload(file: File): Promise<PreparedUpload> {
  assertAllowedImageFile(file);
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Image must be 20 MB or smaller');
  }

  const base = file.name.replace(/\.[^.]+$/, '') || 'memory';

  const compressed = await tryCompressToWebP(file);
  if (compressed) {
    return { blob: compressed, filename: `${base}.webp`, compressed: true };
  }

  if (canStoreDirectly(file)) {
    return {
      blob: file,
      filename: `${base}${extensionForBlob(file, file.name)}`,
      compressed: false,
    };
  }

  throw new Error('Could not compress this image. Try JPEG or PNG instead.');
}

/** @deprecated Prefer prepareImageForUpload — kept for call sites that only need a Blob. */
export async function compressToWebP(file: File): Promise<Blob> {
  const prepared = await prepareImageForUpload(file);
  return prepared.blob;
}

async function tryCompressToWebP(file: File): Promise<Blob | null> {
  let source: Awaited<ReturnType<typeof decodeImage>>;
  try {
    source = await decodeImage(file);
  } catch {
    return null;
  }

  try {
    let scale = Math.min(1, MAX_EDGE / Math.max(source.width, source.height));
    let quality = 0.82;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      const width = Math.max(1, Math.round(source.width * scale));
      const height = Math.max(1, Math.round(source.height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      source.draw(ctx, width, height);

      const blob = await canvasToWebP(canvas, quality);
      if (blob.size <= MAX_BYTES) return blob;

      if (quality > 0.52) {
        quality = Math.max(0.48, quality - 0.08);
      } else {
        const nextEdge = Math.max(source.width, source.height) * scale * 0.82;
        if (nextEdge < MIN_EDGE) break;
        scale *= 0.82;
        quality = 0.76;
      }
    }

    return null;
  } finally {
    source.close?.();
  }
}
