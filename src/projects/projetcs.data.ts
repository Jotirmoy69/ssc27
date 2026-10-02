export type Project = {
  id: number;
  position: number;
  name: string;
  person: string;
  image: string;
  photos: string[];
};

const allImages = Array.from({ length: 17 }, (_, i) => `/images/${i + 1}.jpeg`);

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
