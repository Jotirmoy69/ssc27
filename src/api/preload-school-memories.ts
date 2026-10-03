import { isSidecarStoreName, fetchSharedAlbums } from './albums';
import { imageUrl, listAllImages } from './school-memories';

let cachedUrls: Promise<string[]> | null = null;

export function fetchSchoolMemoryPhotoUrls(force = false): Promise<string[]> {
  if (!cachedUrls || force) {
    cachedUrls = listAllImages().then((items) =>
      items.filter((item) => !isSidecarStoreName(item.name)).map((item) => imageUrl(item.url)),
    );
  }
  return cachedUrls;
}

function loadImage(url: string): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve();
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** Warm a list of image URLs into the browser cache. */
export function preloadImageUrls(urls: string[]): Promise<void> {
  return Promise.all(urls.map(loadImage)).then(() => undefined);
}

/** Fetch album covers/photos and warm them into the browser cache. */
export async function preloadSchoolMemories(): Promise<string[]> {
  const albums = await fetchSharedAlbums(true).catch(() => []);
  const urls = Array.from(
    new Set(albums.flatMap((album) => [album.cover, ...album.photos].filter(Boolean))),
  );
  cachedUrls = Promise.resolve(urls);
  await preloadImageUrls(urls);
  return urls;
}
