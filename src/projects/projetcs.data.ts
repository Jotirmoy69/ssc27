import type { PhotoEntry } from '../api/albums';

export type Project = {
  id: number;
  albumId: string;
  position: number;
  name: string;
  person: string;
  image: string;
  photos: PhotoEntry[];
};

export const projects: Project[] = [];
