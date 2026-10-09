import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { SmoothInput } from '@/components/ui/skiper-ui/skiper106';
import { assertAllowedImageFile, isAllowedImageFile, prepareImageForUpload } from '../api/compress-image';
import { imageUrl, uploadWebP } from '../api/school-memories';
import { useSmoothScroll } from '../lib/smooth-scroll';
import { AnimatedPlusIcon } from './animated-plus-icon';

export type AlbumEditPayload = {
  person: string;
  cover?: string;
};

type AlbumEditProps = {
  albumName: string;
  coverUrl: string;
  onClose: () => void;
  onSave: (payload: AlbumEditPayload) => void | Promise<void>;
  onDelete: () => void | Promise<void>;
};

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,.jpg,.jpeg,.png,.webp,.gif,.avif';

async function uploadFile(file: File): Promise<string> {
  const prepared = await prepareImageForUpload(file);
  const result = await uploadWebP(prepared.blob, prepared.filename);
  const remoteUrl = result.key
    ? imageUrl(`/api/image?key=${encodeURIComponent(result.key)}`)
    : imageUrl(result.url || '');
  if (!remoteUrl) throw new Error('Upload succeeded but no image URL was returned');
  return remoteUrl;
}

export function AlbumEdit({ albumName, coverUrl, onClose, onSave, onDelete }: AlbumEditProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [person, setPerson] = useState(albumName);
  const [coverPreview, setCoverPreview] = useState(coverUrl);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useSmoothScroll(cardRef);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    gsap.fromTo(root, { opacity: 0 }, { opacity: 1, duration: 0.28, ease: 'power2.out' });
    gsap.fromTo(
      root.querySelector('.album-upload__card'),
      { opacity: 0, scale: 0.96, y: 12 },
      { opacity: 1, scale: 1, y: 0, duration: 0.4, ease: 'power3.out' },
    );
  }, []);

  useEffect(() => {
    return () => {
      if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    };
  }, [coverPreview]);

  const name = person.trim();
  const canSave = Boolean(name) && !busy;

  const pickCover = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    try {
      assertAllowedImageFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Only images are allowed');
      return;
    }
    if (!isAllowedImageFile(file)) {
      setError('Only images are allowed');
      return;
    }
    if (coverPreview.startsWith('blob:')) URL.revokeObjectURL(coverPreview);
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
    setError('');
    setStatus('New cover selected');
  };

  const handleSave = async () => {
    if (!canSave) return;
    setBusy(true);
    setError('');
    try {
      let nextCover: string | undefined;
      if (coverFile) {
        setStatus('Uploading cover…');
        nextCover = await uploadFile(coverFile);
      }
      setStatus('Saving album…');
      await onSave({ person: name, cover: nextCover });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save album');
      setStatus('');
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (busy) return;
    if (!window.confirm(`Delete album “${albumName}” and all of its photos? This cannot be undone.`)) {
      return;
    }
    setBusy(true);
    setError('');
    setStatus('Deleting album…');
    try {
      await onDelete();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete album');
      setStatus('');
      setBusy(false);
    }
  };

  return createPortal(
    <div
      ref={rootRef}
      className="album-upload"
      role="dialog"
      aria-modal="true"
      aria-label="Edit album"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div ref={cardRef} className="album-upload__card">
        <span className="album-upload__handle" aria-hidden="true" />
        <header className="album-upload__header">
          <div>
            <h2 className="album-upload__title">Edit album</h2>
            <p className="album-upload__subtitle">Update the name or cover, or delete this album.</p>
          </div>
          <button type="button" className="album-upload__close" onClick={onClose} disabled={busy} aria-label="Close">
            ×
          </button>
        </header>

        <div className="album-upload__body">
          <label className="album-upload__field">
            <span className="album-upload__field-label">Person / album name</span>
            <SmoothInput
              aria-label="Person / album name"
              placeholder="e.g. Jotirmoy"
              value={person}
              disabled={busy}
              fontSize={16}
              onChange={(event) => setPerson(event.target.value)}
            />
          </label>

          <section className="album-upload__section">
            <div className="album-upload__section-head">
              <h3>Cover poster</h3>
              <p>Shown on the homepage. Tap to replace.</p>
            </div>
            <label className="album-upload__drop has-file">
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                hidden
                disabled={busy}
                onChange={(event) => {
                  pickCover(event.target.files);
                  event.target.value = '';
                }}
              />
              <img src={coverPreview} alt="Cover preview" className="album-upload__preview" draggable={false} />
              <span className="album-upload__drop-label album-upload__drop-label--overlay">
                <AnimatedPlusIcon className="album-upload__plus" size={40} />
                Replace cover
              </span>
            </label>
          </section>

          {status ? <p className="album-upload__status">{status}</p> : null}
          {error ? <p className="album-upload__error">{error}</p> : null}
        </div>

        <footer className="album-upload__footer album-upload__footer--edit">
          <button type="button" className="album-upload__btn album-upload__btn--danger" disabled={busy} onClick={() => void handleDelete()}>
            Delete album
          </button>
          <button type="button" className="album-upload__btn" disabled={!canSave} onClick={() => void handleSave()}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
