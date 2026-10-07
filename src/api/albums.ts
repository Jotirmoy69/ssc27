import { imageUrl, listAllImages, uploadWebP } from './school-memories';

const MARKER = '\n<!--SMALBUMS-->';
const STORE_FILENAME = 'sm-albums.webp';

export type PhotoOwner = {
  id: string;
  email: string;
  name?: string;
};

/** One photo inside an album. Legacy string URLs are normalized on read. */
export type PhotoEntry = {
  url: string;
  ownerId: string;
  ownerEmail: string;
  ownerName?: string;
  uploadedAt: string;
};

export type StoredAlbum = {
  id: string;
  person: string;
  cover: string;
  photos: PhotoEntry[];
  createdAt: string;
  createdBy?: PhotoOwner;
};

type RawStoredAlbum = Omit<StoredAlbum, 'photos'> & {
  photos?: Array<string | PhotoEntry>;
};

export function isAlbumStoreName(name: string): boolean {
  return name.includes('sm-albums.webp');
}

export function isSidecarStoreName(name: string): boolean {
  return isAlbumStoreName(name) || name.includes('sm-descriptions.webp');
}

export function normalizePhoto(photo: string | PhotoEntry): PhotoEntry {
  if (typeof photo === 'string') {
    return {
      url: photo,
      ownerId: 'legacy',
      ownerEmail: '',
      uploadedAt: '',
    };
  }
  return {
    url: photo.url,
    ownerId: photo.ownerId || 'legacy',
    ownerEmail: photo.ownerEmail || '',
    ownerName: photo.ownerName,
    uploadedAt: photo.uploadedAt || '',
  };
}

export function albumPhotoUrls(album: Pick<StoredAlbum, 'photos' | 'cover'>): string[] {
  return [album.cover, ...album.photos.map((photo) => photo.url)].filter(Boolean);
}

function normalizeAlbum(raw: RawStoredAlbum): StoredAlbum | null {
  if (!raw || typeof raw.id !== 'string') return null;
  return {
    id: raw.id,
    person: raw.person,
    cover: raw.cover,
    createdAt: raw.createdAt,
    createdBy: raw.createdBy,
    photos: Array.isArray(raw.photos) ? raw.photos.map(normalizePhoto) : [],
  };
}

/**
 * Strip uploader identity for other people.
 * - Admin: full email/name on every photo
 * - Owner: keeps their own fields (UI can show “You”)
 * - Everyone else: no email/name
 */
export function redactAlbumForViewer(
  album: StoredAlbum,
  opts: { isAdmin: boolean; currentUserId?: string | null },
): StoredAlbum {
  if (opts.isAdmin) return album;

  const selfId = opts.currentUserId || null;
  return {
    ...album,
    createdBy: album.createdBy
      ? selfId && album.createdBy.id === selfId
        ? album.createdBy
        : { id: album.createdBy.id, email: '', name: undefined }
      : undefined,
    photos: album.photos.map((photo) => {
      if (selfId && photo.ownerId === selfId) return photo;
      return {
        ...photo,
        ownerEmail: '',
        ownerName: undefined,
      };
    }),
  };
}

/** Visible uploader label: admin sees identity, owner sees “You”, others see nothing. */
export function getUploaderDisplay(
  photo: PhotoEntry,
  opts: { isAdmin: boolean; currentUserId?: string | null },
): { kind: 'admin' | 'self'; label: string } | null {
  const isSelf = Boolean(opts.currentUserId && photo.ownerId === opts.currentUserId);

  if (opts.isAdmin) {
    const email = photo.ownerEmail?.trim();
    const name = photo.ownerName?.trim();
    if (email && name) return { kind: 'admin', label: isSelf ? `${email} (you)` : `${email} · ${name}` };
    if (email) return { kind: 'admin', label: isSelf ? `${email} (you)` : email };
    if (name) return { kind: 'admin', label: isSelf ? `${name} (you)` : name };
    if (photo.ownerId === 'legacy') return { kind: 'admin', label: 'Unknown (legacy)' };
    if (isSelf) return { kind: 'admin', label: 'You' };
    return photo.ownerId ? { kind: 'admin', label: `User ${photo.ownerId.slice(0, 8)}…` } : null;
  }

  if (isSelf) return { kind: 'self', label: 'You' };
  return null;
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
    const parsed = JSON.parse(text.slice(index + MARKER.length)) as RawStoredAlbum[];
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeAlbum).filter((item): item is StoredAlbum => Boolean(item));
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
  createdBy: PhotoOwner;
}): Promise<StoredAlbum> {
  const albums = await fetchSharedAlbums(true);
  const next: StoredAlbum = {
    id: crypto.randomUUID(),
    person: input.person.trim() || 'Untitled',
    cover: input.cover,
    photos: [],
    createdAt: new Date().toISOString(),
    createdBy: input.createdBy,
  };
  const updated = [next, ...albums];
  await persistSharedAlbums(updated);
  return next;
}

export async function appendPhotosToAlbum(
  albumId: string,
  photos: PhotoEntry[],
): Promise<StoredAlbum> {
  const albums = await fetchSharedAlbums(true);
  const index = albums.findIndex((album) => album.id === albumId);
  if (index === -1) throw new Error('Album not found');

  const existingUrls = new Set(albums[index].photos.map((photo) => photo.url));
  const unique = photos.filter((photo) => !existingUrls.has(photo.url));
  const updatedAlbum: StoredAlbum = {
    ...albums[index],
    photos: [...albums[index].photos, ...unique],
  };
  const updated = [...albums];
  updated[index] = updatedAlbum;
  await persistSharedAlbums(updated);
  return updatedAlbum;
}

/** Remove a photo from the album sidecar (does not delete the B2 object by itself). */
export async function removePhotoFromAlbum(albumId: string, photoUrl: string): Promise<StoredAlbum> {
  const albums = await fetchSharedAlbums(true);
  const index = albums.findIndex((album) => album.id === albumId);
  if (index === -1) throw new Error('Album not found');

  const updatedAlbum: StoredAlbum = {
    ...albums[index],
    photos: albums[index].photos.filter((photo) => photo.url !== photoUrl),
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

export function canDeletePhoto(
  photo: PhotoEntry,
  user: { id: string } | null,
  isAdmin: boolean,
): boolean {
  if (!user) return false;
  if (isAdmin) return true;
  if (!photo.ownerId || photo.ownerId === 'legacy') return false;
  return photo.ownerId === user.id;
}
