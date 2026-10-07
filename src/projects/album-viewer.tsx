import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { SmoothInput } from '@/components/ui/skiper-ui/skiper106';
import { canDeletePhoto, getUploaderDisplay, type PhotoEntry } from '../api/albums';
import { useSmoothScroll } from '../lib/smooth-scroll';
import {
  descriptionStorageKey,
  fetchSharedDescriptions,
  persistSharedDescriptions,
} from '../api/descriptions';
import { AnimatedPlusIcon } from './animated-plus-icon';
import type { Project } from './projetcs.data';

export type AlbumOrigin = {
  top: number;
  left: number;
  width: number;
  height: number;
  image: string;
};

type AlbumViewerProps = {
  project: Project;
  origin: AlbumOrigin;
  onClose: () => void;
  onAddPhotos?: () => void;
  onEditAlbum?: () => void;
  onDeletePhoto?: (photo: PhotoEntry) => void | Promise<void>;
  currentUserId?: string | null;
  isAdmin?: boolean;
  /** `stairs` skips the thumbnail expand and reveals fullscreen under the curtain. */
  transition?: 'expand' | 'stairs';
};

type PreviewPhoto = {
  photo: PhotoEntry;
  index: number;
};

function EditableDescription({
  value,
  saving,
  onSave,
}: {
  value: string;
  saving?: boolean;
  onSave: (next: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const committingRef = useRef(false);

  useEffect(() => {
    setDraft(value);
    draftRef.current = value;
    setEditing(false);
  }, [value]);

  const commit = async () => {
    if (committingRef.current) return;
    committingRef.current = true;
    try {
      await onSave(draftRef.current.trim());
      setEditing(false);
    } finally {
      committingRef.current = false;
    }
  };

  const display = value.trim() || '-no description';

  const startEditing = () => {
    draftRef.current = value;
    setDraft(value);
    setEditing(true);
  };

  if (editing) {
    return (
      <SmoothInput
        autoFocus
        className="photo-preview__animated-input"
        wrapperClassName="photo-preview__smooth-input"
        aria-label="Description"
        placeholder="Add a description"
        value={draft}
        fontSize={14}
        onChange={(event) => {
          const next = event.target.value;
          draftRef.current = next;
          setDraft(next);
        }}
        onBlur={() => {
          void commit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            draftRef.current = value;
            setDraft(value);
            setEditing(false);
          }
          if (event.key === 'Enter') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
      />
    );
  }

  return (
    <>
      <p
        className={`photo-preview__text${value.trim() ? '' : ' is-empty'}`}
        onDoubleClick={startEditing}
        onClick={() => {
          // Touch screens have no double-click, so a single tap edits there.
          if (window.matchMedia('(hover: none)').matches) startEditing();
        }}
        title="Double-click to edit"
      >
        {display}
      </p>
      {saving ? <p className="photo-preview__save-status">Saving…</p> : null}
    </>
  );
}

export function AlbumViewer({
  project,
  origin,
  onClose,
  onAddPhotos,
  onEditAlbum,
  onDeletePhoto,
  currentUserId = null,
  isAdmin = false,
  transition = 'expand',
}: AlbumViewerProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const coverRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const previewCardRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const [ready, setReady] = useState(false);
  const [preview, setPreview] = useState<PreviewPhoto | null>(null);
  const [descriptions, setDescriptions] = useState<Record<string, string>>({});
  const [savingDescription, setSavingDescription] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useSmoothScroll(contentRef);
  useSmoothScroll(previewCardRef, { enabled: Boolean(preview) });

  useEffect(() => {
    let cancelled = false;

    fetchSharedDescriptions()
      .then((map) => {
        if (!cancelled) setDescriptions(map);
      })
      .catch(() => {
        // Keep empty map if cloud descriptions cannot load.
      });

    return () => {
      cancelled = true;
    };
  }, [project.id]);

  useEffect(() => {
    const root = rootRef.current;
    const cover = coverRef.current;
    const header = headerRef.current;
    const grid = gridRef.current;
    if (!root || !cover || !header || !grid) return;

    const cells = Array.from(grid.querySelectorAll<HTMLElement>('.album-viewer__cell'));
    const openTl = gsap.timeline({
      onComplete: () => setReady(true),
    });
    closingRef.current = false;
    setReady(false);
    setPreview(null);

    if (transition === 'stairs') {
      gsap.set(root, {
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        borderRadius: 0,
      });
      gsap.set(cover, { opacity: 0 });
      gsap.set(header, { opacity: 1, y: 0 });
      gsap.set(cells, { opacity: 1, scale: 1, y: 0 });
      setReady(true);
    } else {
      gsap.set(root, {
        top: origin.top,
        left: origin.left,
        width: origin.width,
        height: origin.height,
        borderRadius: 0,
      });
      gsap.set(cover, { opacity: 1 });
      gsap.set(header, { opacity: 0, y: -12 });
      gsap.set(cells, { opacity: 0, scale: 0.86, y: 18 });

      openTl
        .to(root, {
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          duration: 1.05,
          ease: 'power4.inOut',
        })
        .to(cover, { opacity: 0, duration: 0.35, ease: 'power2.out' }, '-=0.25')
        .to(header, { opacity: 1, y: 0, duration: 0.45, ease: 'power3.out' }, '-=0.1')
        .to(
          cells,
          {
            opacity: 1,
            scale: 1,
            y: 0,
            duration: 0.45,
            stagger: 0.06,
            ease: 'power3.out',
          },
          '-=0.15',
        );
    }

    const closeAlbum = () => {
      if (closingRef.current) return;
      closingRef.current = true;
      setPreview(null);
      setReady(false);
      openTl.kill();

      if (transition === 'stairs') {
        onCloseRef.current();
        return;
      }

      gsap
        .timeline({ onComplete: () => onCloseRef.current() })
        .to(cells, { opacity: 0, scale: 0.94, duration: 0.22, stagger: 0.015, ease: 'power2.in' })
        .to(header, { opacity: 0, y: -8, duration: 0.2, ease: 'power2.in' }, '-=0.12')
        .to(cover, { opacity: 1, duration: 0.2 }, '-=0.05')
        .to(
          root,
          {
            top: origin.top,
            left: origin.left,
            width: origin.width,
            height: origin.height,
            duration: 0.85,
            ease: 'power4.inOut',
          },
          '-=0.05',
        );
    };

    const backButton = root.querySelector('.album-viewer__back');
    backButton?.addEventListener('click', closeAlbum);

    return () => {
      backButton?.removeEventListener('click', closeAlbum);
      openTl.kill();
    };
  }, [origin, project.id, transition]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (preview) {
        setPreview(null);
        return;
      }
      rootRef.current?.querySelector<HTMLButtonElement>('.album-viewer__back')?.click();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [preview]);

  useEffect(() => {
    const overlay = previewRef.current;
    if (!overlay || !preview) return;

    const card = overlay.querySelector<HTMLElement>('.photo-preview__card');
    gsap.fromTo(overlay, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: 'power2.out' });
    gsap.fromTo(card, { opacity: 0, scale: 0.94, y: 16 }, { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'power3.out' });
  }, [preview]);

  const previewKey = preview ? descriptionStorageKey(preview.photo.url) : '';
  const previewUser = currentUserId ? { id: currentUserId } : null;
  const canDeletePreview =
    preview && onDeletePhoto ? canDeletePhoto(preview.photo, previewUser, isAdmin) : false;
  const previewUploader = preview
    ? getUploaderDisplay(preview.photo, { isAdmin, currentUserId })
    : null;

  return createPortal(
    <div ref={rootRef} className="album-viewer" role="dialog" aria-modal="true" aria-label={`Images of ${project.person}`}>
      <div ref={coverRef} className="album-viewer__cover" style={{ backgroundImage: `url(${origin.image})` }} />

      <div ref={contentRef} className="album-viewer__content">
        <header ref={headerRef} className="album-viewer__header">
          <h1 className="album-viewer__title">Images of {project.person}</h1>
          <div className="album-viewer__actions">
            {onEditAlbum ? (
              <button type="button" className="album-viewer__edit" onClick={onEditAlbum}>
                Edit album
              </button>
            ) : null}
            <button type="button" className="album-viewer__back" aria-label="Back">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                <path d="M8.5 2.5 L4 7 L8.5 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>Back</span>
            </button>
          </div>
        </header>

        <div ref={gridRef} className={`album-viewer__grid${ready ? ' is-ready' : ''}`}>
          {project.photos.map((photo, index) => {
            const uploader = getUploaderDisplay(photo, { isAdmin, currentUserId });
            return (
              <button
                key={`${project.id}-${photo.url}-${index}`}
                type="button"
                className={`album-viewer__cell${uploader ? ' album-viewer__cell--credited' : ''}`}
                disabled={!ready}
                onClick={() => {
                  setDeleteError('');
                  setPreview({ photo, index });
                }}
              >
                <img src={photo.url} alt={`${project.person} photo ${index + 1}`} draggable={false} />
                {uploader ? (
                  <span
                    className={`album-viewer__credit album-viewer__credit--${uploader.kind}`}
                    title={uploader.kind === 'admin' ? uploader.label : 'Uploaded by you'}
                  >
                    {uploader.label}
                  </span>
                ) : null}
              </button>
            );
          })}
          {onAddPhotos ? (
            <button
              type="button"
              className="album-viewer__cell album-viewer__cell--add"
              disabled={!ready}
              aria-label="Add images to album"
              onClick={onAddPhotos}
            >
              <AnimatedPlusIcon className="album-viewer__add-icon" />
            </button>
          ) : null}
        </div>
      </div>

      {preview ? (
        <div
          ref={previewRef}
          className="photo-preview"
          role="dialog"
          aria-modal="true"
          aria-label={`Photo ${preview.index + 1} preview`}
          onClick={(event) => {
            if (event.target === event.currentTarget) setPreview(null);
          }}
        >
          <div ref={previewCardRef} className="photo-preview__card">
            <span className="photo-preview__handle" aria-hidden="true" />
            <button
              type="button"
              className="photo-preview__close"
              aria-label="Close preview"
              onClick={() => setPreview(null)}
            >
              <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6L18 18M18 6L6 18" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
              </svg>
            </button>
            <div className="photo-preview__image">
              <img
                className="photo-preview__image-blur"
                src={preview.photo.url}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
              <img
                className="photo-preview__image-full"
                src={preview.photo.url}
                alt={`${project.person} photo ${preview.index + 1}`}
                draggable={false}
              />
            </div>
            <div className="photo-preview__meta">
              {previewUploader ? (
                <div className={`photo-preview__uploader photo-preview__uploader--${previewUploader.kind}`}>
                  <span className="photo-preview__uploader-label">Uploaded by</span>
                  <span className="photo-preview__uploader-value">{previewUploader.label}</span>
                </div>
              ) : null}
              <h2 className="photo-preview__heading">Description</h2>
              <EditableDescription
                value={descriptions[previewKey] ?? ''}
                saving={savingDescription}
                onSave={async (next) => {
                  let snapshot: Record<string, string> = {};
                  let updated: Record<string, string> = {};

                  setDescriptions((prev) => {
                    snapshot = prev;
                    const previous = prev[previewKey] ?? '';
                    if (next === previous) {
                      updated = prev;
                      return prev;
                    }
                    updated = { ...prev };
                    if (next) updated[previewKey] = next;
                    else delete updated[previewKey];
                    return updated;
                  });

                  if (updated === snapshot || JSON.stringify(updated) === JSON.stringify(snapshot)) return;

                  setSavingDescription(true);
                  setSaveError('');
                  try {
                    await persistSharedDescriptions(updated);
                  } catch (error) {
                    setDescriptions(snapshot);
                    setSaveError(error instanceof Error ? error.message : 'Could not save description');
                  } finally {
                    setSavingDescription(false);
                  }
                }}
              />
              {saveError ? <p className="photo-preview__save-error">{saveError}</p> : null}
              {canDeletePreview ? (
                <button
                  type="button"
                  className="photo-preview__delete"
                  disabled={deleting}
                  onClick={() => {
                    if (!onDeletePhoto || !preview) return;
                    if (!window.confirm('Delete this photo permanently?')) return;
                    setDeleting(true);
                    setDeleteError('');
                    void Promise.resolve(onDeletePhoto(preview.photo))
                      .then(() => setPreview(null))
                      .catch((error) => {
                        setDeleteError(error instanceof Error ? error.message : 'Could not delete photo');
                      })
                      .finally(() => setDeleting(false));
                  }}
                >
                  {deleting ? 'Deleting…' : 'Delete photo'}
                </button>
              ) : null}
              {deleteError ? <p className="photo-preview__save-error">{deleteError}</p> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>,
    document.body,
  );
}
