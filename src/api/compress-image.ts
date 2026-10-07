const MAX_EDGE = 1920;
const MAX_BYTES = 1024 * 1024;
const MIN_QUALITY = 0.5;

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

/** Resize + compress to WebP (<=1920px longest side, <=1MB) for the School Memories API. */
export async function compressToWebP(file: File): Promise<Blob> {
  assertAllowedImageFile(file);
  if (file.size > 20 * 1024 * 1024) {
    throw new Error('Image must be 20 MB or smaller');
  }

  const image = await loadImage(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.drawImage(image, 0, 0, width, height);

  let quality = 0.92;
  let blob = await canvasToWebP(canvas, quality);

  while (blob.size > MAX_BYTES && quality > MIN_QUALITY) {
    quality = Math.max(MIN_QUALITY, quality - 0.08);
    blob = await canvasToWebP(canvas, quality);
  }

  if (blob.size > MAX_BYTES) {
    throw new Error('Could not compress image under 1 MB');
  }

  return blob;
}
