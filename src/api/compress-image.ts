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

/** Resize + compress to WebP (<=1920px longest side, <=1MB) for the School Memories API. */
export async function compressToWebP(file: File): Promise<Blob> {
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
