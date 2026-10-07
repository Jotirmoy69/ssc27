const API_BASE = 'https://school-memory-images.jotirmoyff51976.workers.dev';

export type ApiImage = {
  key: string;
  name: string;
  size: number;
  modified: string;
  url: string;
};

export type ImagesPage = {
  items: ApiImage[];
  next: string | null;
};

export type UploadResult = {
  key?: string;
  name?: string;
  size?: number;
  url?: string;
  ownerId?: string;
  ownerEmail?: string;
  error?: string;
};

type TokenProvider = () => string | null | undefined;

let authTokenProvider: TokenProvider = () => null;

/** Called by AuthProvider so uploads/deletes send the Google ID token. */
export function setAuthTokenProvider(provider: TokenProvider): void {
  authTokenProvider = provider;
}

export function getAuthToken(): string | null {
  return authTokenProvider() ?? null;
}

function authHeaders(extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  const token = authTokenProvider();
  if (token) headers.set('Authorization', `Bearer ${token}`);
  return headers;
}

export function imageUrl(pathOrUrl: string): string {
  if (!pathOrUrl) return '';
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl;
  }
  // Raw B2 object keys must go through the image proxy, not /photos/… on the Worker host.
  if (pathOrUrl.startsWith('photos/')) {
    return `${API_BASE}/api/image?key=${encodeURIComponent(pathOrUrl)}`;
  }
  return `${API_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
}

/** Extract B2 object key from an `/api/image?key=…` URL or a raw `photos/…` key. */
export function photoKeyFromUrl(url: string): string | null {
  if (!url) return null;
  if (url.startsWith('photos/') && !url.includes('..')) return url;
  try {
    const parsed = new URL(url, API_BASE);
    const key = parsed.searchParams.get('key');
    if (key?.startsWith('photos/') && !key.includes('..')) return key;
    return null;
  } catch {
    return null;
  }
}

export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = authHeaders(init.headers);
  return fetch(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`, {
    ...init,
    headers,
  });
}

export async function listImages(cursor?: string): Promise<ImagesPage> {
  const url = new URL(`${API_BASE}/api/images`);
  if (cursor) url.searchParams.set('cursor', cursor);

  const response = await fetch(url);
  if (!response.ok) throw new Error('Could not load photos');
  return response.json() as Promise<ImagesPage>;
}

export async function listAllImages(): Promise<ApiImage[]> {
  const items: ApiImage[] = [];
  let cursor: string | undefined;

  do {
    const page = await listImages(cursor);
    items.push(...page.items);
    cursor = page.next ?? undefined;
  } while (cursor);

  return items;
}

export async function uploadWebP(webpBlob: Blob, filename = 'memory.webp'): Promise<UploadResult> {
  const form = new FormData();
  form.append('file', webpBlob, filename);

  const response = await fetch(`${API_BASE}/api/upload`, {
    method: 'POST',
    headers: authHeaders(),
    body: form,
  });

  const result = (await response.json()) as UploadResult;
  if (!response.ok) throw new Error(result.error || 'Upload failed');
  return result;
}

/**
 * Delete a photo object from B2.
 * Requires a Google ID token; Worker must allow owner or admin.
 */
export async function deletePhoto(key: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/delete`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ key }),
  });

  const result = (await response.json().catch(() => ({}))) as { error?: string; deleted?: boolean };
  if (!response.ok) throw new Error(result.error || 'Delete failed');
}
