import { imageUrl, uploadWebP } from './school-memories';

const MARKER = '\n<!--SMDESC-->';
const STORE_FILENAME = 'sm-descriptions.webp';
/** Stable key used when the Worker writes a fixed sidecar path. */
const STORE_KEY = 'photos/sm-descriptions.webp';

export function isDescriptionStoreName(name: string): boolean {
  return name.includes('sm-descriptions.webp');
}

/** Stable storage key for a photo URL or B2 object key. */
export function descriptionStorageKey(srcOrKey: string): string {
  try {
    const url = new URL(srcOrKey, 'https://school-memory-images.local');
    const key = url.searchParams.get('key');
    if (key) return key;
  } catch {
    // fall through
  }
  return srcOrKey;
}

async function tinyWebP(): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unavailable');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 1, 1);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/webp', 0.8));
  if (!blob) throw new Error('Could not create description store');
  return blob;
}

function parseDescriptionsFromBytes(buffer: ArrayBuffer): Record<string, string> {
  const text = new TextDecoder().decode(buffer);
  const index = text.lastIndexOf(MARKER);
  if (index === -1) return {};

  try {
    const parsed = JSON.parse(text.slice(index + MARKER.length)) as Record<string, string>;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export async function fetchSharedDescriptions(): Promise<Record<string, string>> {
  // Prefer the fixed sidecar key (new Worker hides sidecars from /api/images).
  const direct = await fetch(imageUrl(`/api/image?key=${encodeURIComponent(STORE_KEY)}`));
  if (direct.ok) {
    return parseDescriptionsFromBytes(await direct.arrayBuffer());
  }
  return {};
}

export async function persistSharedDescriptions(map: Record<string, string>): Promise<void> {
  const base = await tinyWebP();
  const payload = new TextEncoder().encode(MARKER + JSON.stringify(map));
  const combined = new Blob([base, payload], { type: 'image/webp' });
  await uploadWebP(combined, STORE_FILENAME);
}
