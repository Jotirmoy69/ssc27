import { apiFetch, imageUrl, photoKeyFromUrl } from './school-memories';

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

type RawStoredAlbum = Omit<StoredAlbum, 'photos' | 'cover'> & {
  cover?: string;
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
      url: imageUrl(photo),
      ownerId: 'legacy',
      ownerEmail: '',
      uploadedAt: '',
    };
  }
  return {
    url: imageUrl(photo.url),
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
    cover: imageUrl(raw.cover || ''),
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

/** Visible uploader label: admin sees email, owner sees “You”, others see nothing. */
export function getUploaderDisplay(
  photo: PhotoEntry,
  opts: { isAdmin: boolean; currentUserId?: string | null },
): { kind: 'admin' | 'self'; label: string } | null {
  const isSelf = Boolean(opts.currentUserId && photo.ownerId === opts.currentUserId);

  if (opts.isAdmin) {
    const email = photo.ownerEmail?.trim();
    if (email) return { kind: 'admin', label: isSelf ? `${email} (you)` : email };
    if (photo.ownerId === 'legacy') return { kind: 'admin', label: 'Unknown (legacy)' };
    if (isSelf) return { kind: 'admin', label: 'You' };
    // Prefer never showing raw Google subject IDs to admins.
    return { kind: 'admin', label: 'Email unavailable' };
  }

  if (isSelf) return { kind: 'self', label: 'You' };
  return null;
}

let cachedAlbums: Promise<StoredAlbum[]> | null = null;

export function fetchSharedAlbums(force = false): Promise<StoredAlbum[]> {
  if (!cachedAlbums || force) {
    cachedAlbums = (async () => {
      // Worker owns the album sidecar now — sidecars are hidden from /api/images.
      const response = await apiFetch('/api/albums');
      if (!response.ok) {
        const result = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(result.error || 'Could not load albums');
      }
      const data = (await response.json()) as { albums?: RawStoredAlbum[] };
      const albums = Array.isArray(data.albums) ? data.albums : [];
      return albums.map(normalizeAlbum).filter((item): item is StoredAlbum => Boolean(item));
    })();
  }
  return cachedAlbums;
}

function cacheAlbums(albums: StoredAlbum[]): void {
  cachedAlbums = Promise.resolve(albums);
}

export async function createSharedAlbum(input: {
  person: string;
  cover: string;
  createdBy?: PhotoOwner;
}): Promise<StoredAlbum> {
  const response = await apiFetch('/api/albums', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      person: input.person.trim() || 'Untitled',
      // Send a full gallery URL (or key). Worker normalizes to /api/image?key=…
      cover: input.cover,
    }),
  });

  const result = (await response.json().catch(() => ({}))) as {
    album?: RawStoredAlbum;
    error?: string;
  };
  if (!response.ok) throw new Error(result.error || 'Could not create album');

  const album = normalizeAlbum(result.album as RawStoredAlbum);
  if (!album) throw new Error('Could not create album');

  const albums = await fetchSharedAlbums(true).catch(() => [] as StoredAlbum[]);
  cacheAlbums([album, ...albums.filter((item) => item.id !== album.id)]);
  return album;
}

export async function appendPhotosToAlbum(
  albumId: string,
  photos: PhotoEntry[] | string[],
): Promise<StoredAlbum> {
  const urls = photos.map((photo) => {
    const url = typeof photo === 'string' ? photo : photo.url;
    const key = photoKeyFromUrl(url);
    // Worker accepts either a photos/… key or an /api/image?key=… URL.
    return key || url;
  });

  const response = await apiFetch(`/api/albums/${encodeURIComponent(albumId)}/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ photos: urls }),
  });

  const result = (await response.json().catch(() => ({}))) as {
    album?: RawStoredAlbum;
    error?: string;
  };
  if (!response.ok) throw new Error(result.error || 'Could not add photos');

  const album = normalizeAlbum(result.album as RawStoredAlbum);
  if (!album) throw new Error('Could not add photos');

  const albums = await fetchSharedAlbums(true).catch(() => [] as StoredAlbum[]);
  cacheAlbums(albums.map((item) => (item.id === album.id ? album : item)));
  return album;
}

/** Remove a photo from the album and delete the B2 object (Worker-enforced ownership). */
export async function removePhotoFromAlbum(albumId: string, photoUrl: string): Promise<StoredAlbum> {
  const key = photoKeyFromUrl(photoUrl);
  const response = await apiFetch(`/api/albums/${encodeURIComponent(albumId)}/photos`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(key ? { key } : { url: photoUrl }),
  });

  const result = (await response.json().catch(() => ({}))) as { error?: string; deleted?: boolean };
  if (!response.ok) throw new Error(result.error || 'Could not delete photo');

  const albums = await fetchSharedAlbums(true);
  const album = albums.find((item) => item.id === albumId);
  if (!album) throw new Error('Album not found');
  return album;
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
