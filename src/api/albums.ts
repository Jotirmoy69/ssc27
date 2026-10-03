import { imageUrl, listAllImages, uploadWebP } from './school-memories';

const MARKER = '\n<!--SMALBUMS-->';
const STORE_FILENAME = 'sm-albums.webp';

export type StoredAlbum = {
  id: string;
  person: string;
  cover: string;
  photos: string[];
  createdAt: string;
};

export function isAlbumStoreName(name: string): boolean {
  return name.includes('sm-albums.webp');
}

export function isSidecarStoreName(name: string): boolean {
  return isAlbumStoreName(name) || name.includes('sm-descriptions.webp');
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
  if (!blob) throw new Error('Could not create album store');
  return blob;
}

function parseAlbumsFromBytes(buffer: ArrayBuffer): StoredAlbum[] {
  const text = new TextDecoder().decode(buffer);
  const index = text.lastIndexOf(MARKER);
  if (index === -1) return [];

  try {
    const parsed = JSON.parse(text.slice(index + MARKER.length)) as StoredAlbum[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === 'string') : [];
  } catch {
    return [];
  }
}

let cachedAlbums: Promise<StoredAlbum[]> | null = null;

export function fetchSharedAlbums(force = false): Promise<StoredAlbum[]> {
  if (!cachedAlbums || force) {
    cachedAlbums = (async () => {
      const items = await listAllImages();
      const stores = items
        .filter((item) => isAlbumStoreName(item.name))
        .sort((a, b) => b.modified.localeCompare(a.modified));

      if (!stores.length) return [];

      const response = await fetch(imageUrl(stores[0].url));
      if (!response.ok) throw new Error('Could not load albums');
      return parseAlbumsFromBytes(await response.arrayBuffer());
    })();
  }
  return cachedAlbums;
}

export async function persistSharedAlbums(albums: StoredAlbum[]): Promise<void> {
  const base = await tinyWebP();
  const payload = new TextEncoder().encode(MARKER + JSON.stringify(albums));
  const combined = new Blob([base, payload], { type: 'image/webp' });
  await uploadWebP(combined, STORE_FILENAME);
  cachedAlbums = Promise.resolve(albums);
}

export async function createSharedAlbum(input: {
  person: string;
  cover: string;
}): Promise<StoredAlbum> {
  const albums = await fetchSharedAlbums(true);
  const next: StoredAlbum = {
    id: crypto.randomUUID(),
    person: input.person.trim() || 'Untitled',
    cover: input.cover,
    photos: [],
    createdAt: new Date().toISOString(),
  };
  const updated = [next, ...albums];
  await persistSharedAlbums(updated);
  return next;
}

export async function appendPhotosToAlbum(albumId: string, photoUrls: string[]): Promise<StoredAlbum> {
  const albums = await fetchSharedAlbums(true);
  const index = albums.findIndex((album) => album.id === albumId);
  if (index === -1) throw new Error('Album not found');

  const unique = photoUrls.filter((url) => !albums[index].photos.includes(url));
  const updatedAlbum: StoredAlbum = {
    ...albums[index],
    photos: [...albums[index].photos, ...unique],
  };
  const updated = [...albums];
  updated[index] = updatedAlbum;
  await persistSharedAlbums(updated);
  return updatedAlbum;
}

/** Stable numeric id for UI keys from a UUID-like string. */
export function albumNumericId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return hash === 0 ? 1 : Math.abs(hash);
}
