export type Project = {
  id: number;
  albumId: string;
  position: number;
  name: string;
  person: string;
  image: string;
  photos: string[];
};

export const projects: Project[] = [];
