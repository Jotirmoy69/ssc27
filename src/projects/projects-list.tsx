import type { Project } from './projetcs.data';

type ProjectsListProps = {
  projects: Project[];
  onOpenAlbum: (project: Project, imageEl: HTMLElement) => void;
  onAddAlbum: () => void;
};

function EyeIcon() {
  return (
    <svg
      className="eye-icon"
      xmlns="http://www.w3.org/2000/svg"
      width="64"
      height="64"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <g transform="translate(0 -2)">
        <path
          className="eye-icon__closed"
          d="M 3 14 C 6.2 12.4 9 11.7 12 11.7 S 17.8 12.4 21 14"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.5"
        />

        <g className="eye-icon__open">
          <path
            className="eye-icon__lid"
            d="M 2.4787 10.6666 c 2.42 -2.468 5.792 -4 9.5213 -4 s 7.1013 1.5307 9.5213 4"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <circle
            className="eye-icon__pupil"
            cx="12"
            cy="14"
            r="3.6667"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.5"
          />
          <g className="eye-icon__lashes">
            <line
              x1="5.3613"
              y1="8.4373"
              x2="3.6667"
              y2="5.6667"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <line
              x1="9.7333"
              y1="6.8586"
              x2="9.0973"
              y2="3.692"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <line
              x1="18.6386"
              y1="8.4373"
              x2="20.3333"
              y2="5.6667"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <line
              x1="14.2666"
              y1="6.8586"
              x2="14.9026"
              y2="3.692"
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}

function PlusIcon() {
  return (
    <span className="album-add__icon" aria-hidden="true">
      <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="32" cy="32" r="28" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 3.5" />
        <path d="M32 20v24M20 32h24" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function ProjectsList({ projects, onOpenAlbum, onAddAlbum }: ProjectsListProps) {
  return (
    <div className="projects-list">
      <div className="projects-list__contents">
        {projects.map((project) => (
          <button
            key={project.id}
            type="button"
            className="project"
            onClick={(event) => {
              const imageEl = event.currentTarget.querySelector<HTMLElement>('.project__image');
              if (imageEl) onOpenAlbum(project, imageEl);
            }}
          >
            <p className="project__number">{project.position}</p>
            <span className="project__image">
              <img src={project.image} alt={project.name} draggable={false} />
              <span className="project__icon">
                <EyeIcon />
              </span>
            </span>
          </button>
        ))}

        <button type="button" className="album-add" onClick={onAddAlbum} aria-label="Upload new album">
          <p className="project__number">{projects.length + 1}</p>
          <span className="album-add__box">
            <PlusIcon />
          </span>
        </button>
      </div>
      <div className="projects-list__preview">
        <p className="projects-years">
          <span>2024</span>
          <span />
          <span>2025</span>
        </p>
      </div>
    </div>
  );
}
