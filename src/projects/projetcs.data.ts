export type Project = {
  id: number;
  position: number;
  name: string;
  person: string;
  image: string;
  photos: string[];
};

const imageModules = import.meta.glob('../assets/images/*.{jpeg,jpg,webp,png}', {
  eager: true,
  import: 'default',
}) as Record<string, string>;

function resolveLocalImage(n: number): string {
  const match = Object.entries(imageModules).find(([path]) => {
    const file = path.split('/').pop() ?? '';
    return file === `${n}.jpeg` || file === `${n}.jpg` || file === `${n}.webp` || file === `${n}.png`;
  });
  return match?.[1] ?? `/images/${n}.jpeg`;
}

const allImages = Array.from({ length: 17 }, (_, i) => resolveLocalImage(i + 1));

const people = [
  'Jotirmoy',
  'Aria',
  'Kenji',
  'Maya',
  'Noah',
  'Lina',
  'Omar',
  'Elena',
  'Felix',
  'Priya',
  'Hugo',
  'Sofia',
  'Ravi',
  'Clara',
  'Jonas',
  'Amira',
  'Theo',
];

function albumPhotos(coverIndex: number, count = 18): string[] {
  return Array.from({ length: count }, (_, i) => allImages[(coverIndex + i) % allImages.length]);
}

export const projects: Project[] = allImages.map((image, id) => ({
  id,
  position: id + 1,
  name: `project ${id + 1}`,
  person: people[id] ?? `Person ${id + 1}`,
  image,
  photos: albumPhotos(id),
}));
