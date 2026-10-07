import type { PhotoEntry } from '../api/albums';

export type Project = {
  id: number;
  albumId: string;
  position: number;
  name: string;
  person: string;
  image: string;
  photos: PhotoEntry[];
  /** Google subject of the album creator — used for owner edit/delete. */
  createdById?: string;
};

export const projects: Project[] = [];
