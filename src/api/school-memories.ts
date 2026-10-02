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
  error?: string;
};

export function imageUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('data:')) {
    return pathOrUrl;
  }
  return `${API_BASE}${pathOrUrl.startsWith('/') ? '' : '/'}${pathOrUrl}`;
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
    body: form,
  });

  const result = (await response.json()) as UploadResult;
  if (!response.ok) throw new Error(result.error || 'Upload failed');
  return result;
}
