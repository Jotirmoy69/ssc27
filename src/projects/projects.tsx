import { useEffect, useRef, useState } from 'react';
import Lenis from 'lenis';

import { gsap } from 'gsap';
import { useGSAP } from '@gsap/react';
import { Flip } from 'gsap/Flip';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

import PagePreloader from '@/components/ui/smoothui/page-preloader';
import {
  albumNumericId,
  appendPhotosToAlbum,
  canManageAlbum,
  createSharedAlbum,
  deleteSharedAlbum,
  fetchSharedAlbums,
  redactAlbumForViewer,
  removePhotoFromAlbum,
  updateSharedAlbum,
  type PhotoEntry,
  type StoredAlbum,
} from '../api/albums';
import { preloadImageUrls } from '../api/preload-school-memories';
import { useAuth } from '../auth/auth-context';
import { AlbumEdit, type AlbumEditPayload } from './album-edit';
import {
  AlbumUpload,
  type AddedPhotosPayload,
  type CreatedAlbumPayload,
} from './album-upload';
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

type UploadState =
  | { mode: 'create' }
  | { mode: 'add'; albumId: string; albumName: string }
  | { mode: 'edit'; albumId: string; albumName: string; coverUrl: string };

const STAIRS_COLUMNS = 6;
const STAIRS_ENTER_MS = (0.55 + (STAIRS_COLUMNS - 1) * 0.06) * 1000;
const ALBUM_HOLD_MS = 700;

function toProject(album: StoredAlbum, position: number): Project {
  return {
    id: albumNumericId(album.id),
    albumId: album.id,
    position,
    name: album.person,
    person: album.person,
    image: album.cover,
    photos: album.photos,
    createdById: album.createdBy?.id,
  };
}

export function Projects() {
  const { user, isAdmin, requireAuth } = useAuth();
  const [projects, setProjects] = useState<Project[]>([]);
  const [openAlbum, setOpenAlbum] = useState<OpenAlbum | null>(null);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const [stairsActive, setStairsActive] = useState(false);
  const openingRef = useRef(false);

  const syncAlbums = async (force = false) => {
    const albums = await fetchSharedAlbums(force);
    setProjects(
      albums
        .map((album) => redactAlbumForViewer(album, { isAdmin, currentUserId: user?.id ?? null }))
        .map((album, index) => toProject(album, index + 1)),
    );
  };

  useEffect(() => {
    let cancelled = false;

    syncAlbums()
      .catch(() => {
        if (!cancelled) setProjects([]);
      });

    return () => {
      cancelled = true;
    };
  }, [isAdmin, user?.id]);

  // Keep the open album in sync when admin status / ownership fields refresh.
  useEffect(() => {
    setOpenAlbum((prev) => {
      if (!prev) return prev;
      const next = projects.find((item) => item.albumId === prev.project.albumId);
      return next ? { ...prev, project: next } : prev;
    });
  }, [projects]);

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

  const runStairs = async (duringHold: () => void | Promise<void>) => {
    if (openingRef.current || stairsActive) return;
    openingRef.current = true;
    setStairsActive(true);

    try {
      await new Promise<void>((resolve) => setTimeout(resolve, STAIRS_ENTER_MS));
      await Promise.all([
        Promise.resolve(duringHold()),
        new Promise<void>((resolve) => setTimeout(resolve, ALBUM_HOLD_MS)),
      ]);
    } finally {
      setStairsActive(false);
    }
  };

  const handleOpenAlbum = (project: Project, imageEl: HTMLElement) => {
    const rect = imageEl.getBoundingClientRect();
    const nextAlbum: OpenAlbum = {
      project,
      origin: {
        top: rect.top,
        left: rect.left,
        width: rect.width,
        height: rect.height,
        image: project.image,
      },
    };

    void runStairs(async () => {
      setOpenAlbum(nextAlbum);
      await preloadImageUrls(project.photos.map((photo) => photo.url)).catch(() => undefined);
    });
  };

  const handleCloseAlbum = () => {
    void runStairs(() => {
      setOpenAlbum(null);
    });
  };

  const handleCreateAlbum = async (payload: CreatedAlbumPayload) => {
    if (!user) throw new Error('Sign in required');
    const album = await createSharedAlbum({
      person: payload.person,
      cover: payload.cover,
      createdBy: { id: user.id, email: user.email, name: user.name },
    });
    await syncAlbums(true);
    setUpload(null);
    await preloadImageUrls([album.cover]).catch(() => undefined);
  };

  const handleAddPhotos = async (payload: AddedPhotosPayload) => {
    if (!upload || upload.mode !== 'add') return;
    if (!user) throw new Error('Sign in required');

    // Worker stamps ownership from the Google token.
    const updated = await appendPhotosToAlbum(upload.albumId, payload.photos);
    const project = toProject(
      redactAlbumForViewer(updated, { isAdmin, currentUserId: user.id }),
      projects.find((item) => item.albumId === updated.id)?.position ?? 1,
    );
    setProjects((prev) => prev.map((item) => (item.albumId === project.albumId ? project : item)));
    setOpenAlbum((prev) => (prev && prev.project.albumId === project.albumId ? { ...prev, project } : prev));
    setUpload(null);
    await preloadImageUrls(payload.photos).catch(() => undefined);
  };

  const handleDeletePhoto = async (photo: PhotoEntry) => {
    if (!openAlbum) return;
    if (!user) throw new Error('Sign in required');

    const updated = await removePhotoFromAlbum(openAlbum.project.albumId, photo.url);
    const project = toProject(
      redactAlbumForViewer(updated, { isAdmin, currentUserId: user.id }),
      openAlbum.project.position,
    );
    setProjects((prev) => prev.map((item) => (item.albumId === project.albumId ? project : item)));
    setOpenAlbum((prev) => (prev ? { ...prev, project } : prev));
  };

  const handleEditAlbum = async (payload: AlbumEditPayload) => {
    if (!upload || upload.mode !== 'edit') return;
    if (!user) throw new Error('Sign in required');

    const updated = await updateSharedAlbum(upload.albumId, {
      person: payload.person,
      cover: payload.cover,
    });
    const project = toProject(
      redactAlbumForViewer(updated, { isAdmin, currentUserId: user.id }),
      projects.find((item) => item.albumId === updated.id)?.position ?? 1,
    );
    setProjects((prev) => prev.map((item) => (item.albumId === project.albumId ? project : item)));
    setOpenAlbum((prev) =>
      prev && prev.project.albumId === project.albumId
        ? { ...prev, project, origin: { ...prev.origin, image: project.image } }
        : prev,
    );
    setUpload(null);
    if (payload.cover) await preloadImageUrls([payload.cover]).catch(() => undefined);
  };

  const handleDeleteAlbum = async () => {
    if (!upload || upload.mode !== 'edit') return;
    if (!user) throw new Error('Sign in required');

    const albumId = upload.albumId;
    await deleteSharedAlbum(albumId);
    setUpload(null);
    setOpenAlbum(null);
    await syncAlbums(true);
  };

  const overlayOpen = Boolean(openAlbum || upload || stairsActive);
  const canEditOpenAlbum = Boolean(
    openAlbum && canManageAlbum({ createdById: openAlbum.project.createdById }, user, isAdmin),
  );

  return (
    <ProjectsWrapper>
      <ProjectsList
        projects={projects}
        onOpenAlbum={handleOpenAlbum}
        onAddAlbum={() => requireAuth(() => setUpload({ mode: 'create' }))}
      />
      <div className={`switcher-slot${overlayOpen ? ' is-hidden' : ''}`}>
        <ProjectsSwitcher />
      </div>
      {openAlbum ? (
        <AlbumViewer
          project={openAlbum.project}
          origin={openAlbum.origin}
          transition="stairs"
          onClose={handleCloseAlbum}
          isAdmin={isAdmin}
          currentUserId={user?.id ?? null}
          onDeletePhoto={handleDeletePhoto}
          onEditAlbum={
            canEditOpenAlbum
              ? () =>
                  requireAuth(() =>
                    setUpload({
                      mode: 'edit',
                      albumId: openAlbum.project.albumId,
                      albumName: openAlbum.project.person,
                      coverUrl: openAlbum.project.image,
                    }),
                  )
              : undefined
          }
          onAddPhotos={() =>
            requireAuth(() =>
              setUpload({
                mode: 'add',
                albumId: openAlbum.project.albumId,
                albumName: openAlbum.project.person,
              }),
            )
          }
        />
      ) : null}
      {upload?.mode === 'create' ? (
        <AlbumUpload mode="create" onClose={() => setUpload(null)} onComplete={handleCreateAlbum} />
      ) : null}
      {upload?.mode === 'add' ? (
        <AlbumUpload
          mode="add"
          albumName={upload.albumName}
          onClose={() => setUpload(null)}
          onComplete={handleAddPhotos}
        />
      ) : null}
      {upload?.mode === 'edit' ? (
        <AlbumEdit
          albumName={upload.albumName}
          coverUrl={upload.coverUrl}
          onClose={() => setUpload(null)}
          onSave={handleEditAlbum}
          onDelete={handleDeleteAlbum}
        />
      ) : null}
      <PagePreloader
        variant="stairs"
        background="bg-black"
        active={stairsActive}
        columns={STAIRS_COLUMNS}
        defaultActive={false}
        onComplete={() => {
          openingRef.current = false;
        }}
      />
    </ProjectsWrapper>
  );
}
