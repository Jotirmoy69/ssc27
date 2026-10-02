import { useEffect, useState } from 'react';
import Lenis from 'lenis';

import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import { isDescriptionStoreName } from '../api/descriptions';
import { imageUrl, listAllImages } from '../api/school-memories';
import { AlbumUpload, type UploadedAlbum } from './album-upload';
import { AlbumViewer, type AlbumOrigin } from './album-viewer';
import { ProjectsList } from './projects-list';
import { ProjectsSwitcher } from './projects-switcher';
import { ProjectsWrapper } from './projects-wrapper';
import type { Project } from './projetcs.data';

import './index.css';

gsap.registerPlugin(useGSAP, Flip, ScrollTrigger);

type OpenAlbum = {
  project: Project;
  origin: AlbumOrigin;
};

const CLOUD_ALBUM_ID = -1;

export function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [openAlbum, setOpenAlbum] = useState<OpenAlbum | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);

  const syncCloudAlbum = async () => {
    const items = await listAllImages();
    const photos = items
      .filter((item) => !isDescriptionStoreName(item.name))
      .map((item) => imageUrl(item.url));

    if (!photos.length) {
      setProjects([]);
      return;
    }

    setProjects([
      {
        id: CLOUD_ALBUM_ID,
        position: 1,
        name: 'School Memories',
        person: 'School Memories',
        image: photos[0],
        photos,
      },
    ]);
  };

  useEffect(() => {
    let cancelled = false;

    syncCloudAlbum()
      .catch(() => {
        if (!cancelled) setProjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useGSAP(() => {
    const wrapper = document.querySelector('.wrapper');
    const content = document.querySelector('.scroller');

    if (!content || !wrapper) return;

    const lenis = new Lenis({ wrapper, content, autoRaf: false });
    lenis.on('scroll', ScrollTrigger.update);
    const tickerFn = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tickerFn);
    gsap.ticker.lagSmoothing(0);

    const projectsList = document.querySelector('.projects-list');
    const projectsListContents = document.querySelector('.projects-list__contents');
    const projectsListPreview = document.querySelector('.projects-list__preview');
    const gridButton = document.querySelector('.switcher__button--grid');
    const sliderButton = document.querySelector('.switcher__button--slider');
    const indicator = document.querySelector('.switcher__indicator');

    const tl = gsap.timeline();

    const onGridClick = () => {
      gsap.set([gridButton, sliderButton], { pointerEvents: 'none' });
      gsap.to(indicator, { x: 0, duration: 1.2, ease: 'power4.inOut' });

      gridButton?.classList.add('is-active');
      sliderButton?.classList.remove('is-active');

      lenis.scrollTo(0, {
        duration: 1,
        onComplete: () => {
          const state = Flip.getState('.project, .album-add');

          projectsList?.classList.remove('is-slider');
          projectsListContents?.classList.remove('is-slider');
          gsap.set(projectsListContents, { clearProps: 'x' });

          Flip.from(state, {
            duration: 1.4,
            absolute: true,
            ease: 'power2.inOut',
            stagger: { from: 'start', each: 0.03 },
            onComplete: () => {
              ScrollTrigger.killAll();
              gsap.set([gridButton, sliderButton], { pointerEvents: 'auto' });
            },
          });

          tl.clear();
          tl.to(projectsListPreview, { clipPath: 'inset(0% 0% 0% 0%)', delay: 1.6, duration: 1.4, ease: 'power4.out' });
        },
      });
    };

    const onSliderClick = () => {
      const state = Flip.getState('.project, .album-add');

      gsap.set([gridButton, sliderButton], { pointerEvents: 'none' });
      gsap.to(indicator, { x: 80, duration: 1.2, ease: 'power4.inOut' });

      lenis.scrollTo(0, { duration: 0.001 });

      sliderButton?.classList.add('is-active');
      gridButton?.classList.remove('is-active');
      projectsList?.classList.add('is-slider');
      projectsListContents?.classList.add('is-slider');

      tl.clear();
      tl.to(projectsListPreview, { clipPath: 'inset(0% 0% 0% 100%)', duration: 1.4, ease: 'power4.out' });

      Flip.from(state, {
        delay: 0.3,
        duration: 1.4,
        absolute: true,
        ease: 'power2.inOut',
        stagger: { from: 'start', each: 0.03 },
        onComplete: () => {
          gsap.set([gridButton, sliderButton], { pointerEvents: 'auto' });

          const projectsElements = document.querySelectorAll('.project, .album-add');
          if (!projectsElements.length) return;

          const card = projectsElements[0].getBoundingClientRect();
          const totalWidth = card.width * projectsElements.length + card.width * 0.4;

          tl.to(projectsListContents, {
            x: `-${totalWidth}px`,
            scrollTrigger: { scrub: true, start: 'top top', end: '+=10000px', trigger: wrapper, scroller: wrapper },
          });
        },
      });
    };

    gridButton?.addEventListener('click', onGridClick);
    sliderButton?.addEventListener('click', onSliderClick);

    return () => {
      gridButton?.removeEventListener('click', onGridClick);
      sliderButton?.removeEventListener('click', onSliderClick);
      gsap.ticker.remove(tickerFn);
      lenis.destroy();
      ScrollTrigger.killAll();
      tl.kill();
    };
  });

  const handleOpenAlbum = (project: Project, imageEl: HTMLElement) => {
    const rect = imageEl.getBoundingClientRect();
    setOpenAlbum({
      project,
      origin: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        image: project.image,
      },
    });
  };

  const handleUploadComplete = (_album: UploadedAlbum) => {
    setUploadOpen(false);
    void syncCloudAlbum().catch(() => {
      // Keep current album if refresh fails.
    });
  };

  const overlayOpen = Boolean(openAlbum || uploadOpen);

  return (
    <ProjectsWrapper>
      <ProjectsList projects={projects} onOpenAlbum={handleOpenAlbum} onAddAlbum={() => setUploadOpen(true)} />
      <div className={`switcher-slot${overlayOpen ? ' is-hidden' : ''}`}>
        <ProjectsSwitcher />
      </div>
      {openAlbum ? (
        <AlbumViewer project={openAlbum.project} origin={openAlbum.origin} onClose={() => setOpenAlbum(null)} />
      ) : null}
      {uploadOpen ? <AlbumUpload onClose={() => setUploadOpen(false)} onComplete={handleUploadComplete} /> : null}
    </ProjectsWrapper>
  );
}
