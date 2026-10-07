import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { motion, useReducedMotion } from 'motion/react';
import { SmoothInput } from '@/components/ui/skiper-ui/skiper106';
import { assertAllowedImageFile, compressToWebP, isAllowedImageFile } from '../api/compress-image';
import { imageUrl, uploadWebP } from '../api/school-memories';
import { AnimatedPlusIcon } from './animated-plus-icon';

/** Cover: tighter list is fine (single file). */
const COVER_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/avif,.jpg,.jpeg,.png,.webp,.gif,.avif';
/**
 * Multi-select on iOS/Android often breaks with a long MIME/extension list.
 * Use image/* so the Photos app allows tapping multiple; JS still rejects videos.
 */
const MULTI_IMAGE_ACCEPT = 'image/*';

export type CreatedAlbumPayload = {
  person: string;
  cover: string;
};

export type AddedPhotosPayload = {
  photos: string[];
};

type CreateProps = {
  mode: 'create';
  onClose: () => void;
  onComplete: (album: CreatedAlbumPayload) => void | Promise<void>;
};

type AddProps = {
  mode: 'add';
  albumName?: string;
  onClose: () => void;
  onComplete: (payload: AddedPhotosPayload) => void | Promise<void>;
};

type AlbumUploadProps = CreateProps | AddProps;

type LocalFile = {
  id: string;
  file: File;
  preview: string;
};

function AnimatedCloseIcon() {
  const reduceMotion = useReducedMotion();

  return (
    <motion.span
      className="album-upload__close-icon"
      aria-hidden="true"
      initial={reduceMotion ? false : { rotate: -90, opacity: 0, scale: 0.7 }}
      animate={{ rotate: 0, opacity: 1, scale: 1 }}
      whileHover={reduceMotion ? undefined : { rotate: 90, scale: 1.08 }}
      whileTap={reduceMotion ? undefined : { scale: 0.92 }}
      transition={{ type: 'spring', stiffness: 420, damping: 22 }}
    >
      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <motion.path
          d="M6 6L18 18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        />
        <motion.path
          d="M18 6L6 18"
          stroke="currentColor"
          strokeWidth="1.75"
          strokeLinecap="round"
          initial={reduceMotion ? false : { pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
    </motion.span>
  );
}

async function uploadFile(file: File): Promise<string> {
  const webp = await compressToWebP(file);
  const result = await uploadWebP(webp, `${file.name.replace(/\.[^.]+$/, '') || 'memory'}.webp`);
  // Prefer the Worker key path so album attach can resolve ownership reliably.
  const remoteUrl = result.key
    ? imageUrl(`/api/image?key=${encodeURIComponent(result.key)}`)
    : imageUrl(result.url || '');
  if (!remoteUrl) throw new Error('Upload succeeded but no image URL was returned');
  return remoteUrl;
}

function revokePreview(preview: string) {
  if (preview.startsWith('blob:')) URL.revokeObjectURL(preview);
}

export function AlbumUpload(props: AlbumUploadProps) {
  const { mode, onClose } = props;
  const rootRef = useRef<HTMLDivElement>(null);
  const [person, setPerson] = useState('');
  const [cover, setCover] = useState<LocalFile | null>(null);
  const [photos, setPhotos] = useState<LocalFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

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
      if (cover) revokePreview(cover.preview);
      photos.forEach((photo) => revokePreview(photo.preview));
    };
  }, [cover, photos]);

  const pickCover = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    try {
      assertAllowedImageFile(file);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Only images are allowed');
      setStatus('');
      return;
    }
    if (cover) revokePreview(cover.preview);
    setCover({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
    });
    setError('');
    setStatus('Cover selected');
  };

  const pickPhotos = (files: FileList | null) => {
    if (!files?.length) return;
    const selected = Array.from(files);
    const images = selected.filter(isAllowedImageFile);
    const rejected = selected.length - images.length;

    if (!images.length) {
      setError('Videos are not allowed. Upload photos only.');
      setStatus('');
      return;
    }

    const next = images.map((file) => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
    }));
    setPhotos((prev) => [...prev, ...next]);
    setError(rejected > 0 ? `${rejected} video/unsupported file${rejected === 1 ? '' : 's'} skipped` : '');
    setStatus(`${next.length} image${next.length === 1 ? '' : 's'} ready`);
  };

  const albumName = person.trim();
  const canFinish =
    mode === 'create' ? Boolean(albumName && cover) : photos.length > 0;

  const handleProceed = async () => {
    if (!canFinish || busy) return;
    setBusy(true);
    setError('');

    try {
      if (mode === 'create') {
        if (!albumName) {
          setError('Enter an album name before proceeding.');
          setBusy(false);
          return;
        }
        if (!cover) {
          setError('Choose a cover photo before proceeding.');
          setBusy(false);
          return;
        }
        setStatus('Uploading cover…');
        const coverUrl = await uploadFile(cover.file);
        setStatus('Saving album…');
        await props.onComplete({
          person: albumName,
          cover: coverUrl,
        });
        return;
      }

      const urls: string[] = [];
      for (let index = 0; index < photos.length; index += 1) {
        setStatus(`Uploading image ${index + 1} of ${photos.length}…`);
        urls.push(await uploadFile(photos[index].file));
      }
      setStatus('Saving to album…');
      await props.onComplete({ photos: urls });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStatus('');
      setBusy(false);
    }
  };

  const title = mode === 'create' ? 'Create album' : 'Add images';
  const subtitle =
    mode === 'create'
      ? 'Add a cover for the homepage. You can upload album photos after opening it.'
      : `Upload photos${props.mode === 'add' && props.albumName ? ` to ${props.albumName}` : ''}. They save when you hit Proceed.`;

  return createPortal(
    <div
      ref={rootRef}
      className="album-upload"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="album-upload__card">
        <span className="album-upload__handle" aria-hidden="true" />
        <header className="album-upload__header">
          <div>
            <h2 className="album-upload__title">{title}</h2>
            <p className="album-upload__subtitle">{subtitle}</p>
          </div>
          <button
            type="button"
            className="album-upload__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close"
          >
            <AnimatedCloseIcon />
          </button>
        </header>

        <div className="album-upload__body">
          {mode === 'create' ? (
            <>
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
                  <p>Shown on the homepage with the eye hover.</p>
                </div>

                <label className={`album-upload__drop${cover ? ' has-file' : ''}`}>
                  <input
                    type="file"
                    accept={COVER_ACCEPT}
                    className="album-upload__file-input"
                    disabled={busy}
                    onChange={(event) => {
                      pickCover(event.target.files);
                      event.target.value = '';
                    }}
                  />
                  {cover ? (
                    <img src={cover.preview} alt="Cover preview" className="album-upload__preview" draggable={false} />
                  ) : (
                    <span className="album-upload__drop-label">
                      <AnimatedPlusIcon className="album-upload__plus" size={48} />
                      Choose cover poster
                    </span>
                  )}
                </label>
              </section>
            </>
          ) : (
            <section className="album-upload__section">
              <div className="album-upload__section-head">
                <h3>Album images</h3>
                <p>Select multiple photos at once, then Proceed to save them.</p>
              </div>

              <label className="album-upload__drop album-upload__drop--multi">
                <input
                  type="file"
                  accept={MULTI_IMAGE_ACCEPT}
                  multiple={true}
                  className="album-upload__file-input"
                  disabled={busy}
                  onChange={(event) => {
                    pickPhotos(event.target.files);
                    event.target.value = '';
                  }}
                />
                <span className="album-upload__drop-label">
                  <AnimatedPlusIcon className="album-upload__plus" size={48} />
                  Add images
                </span>
              </label>

              {photos.length > 0 ? (
                <div className="album-upload__thumbs">
                  {photos.map((photo, index) => (
                    <div key={photo.id} className="album-upload__thumb">
                      <img src={photo.preview} alt={`Upload ${index + 1}`} draggable={false} />
                      <button
                        type="button"
                        className="album-upload__thumb-remove"
                        aria-label={`Remove photo ${index + 1}`}
                        disabled={busy}
                        onClick={() => {
                          revokePreview(photo.preview);
                          setPhotos((prev) => prev.filter((item) => item.id !== photo.id));
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          )}

          {status ? <p className="album-upload__status">{status}</p> : null}
          {error ? <p className="album-upload__error">{error}</p> : null}
        </div>

        <footer className="album-upload__footer">
          <span className="album-upload__hint">
            {mode === 'create'
              ? !albumName && !cover
                ? 'Name and cover needed'
                : !albumName
                  ? 'Album name needed'
                  : !cover
                    ? 'Cover needed'
                    : 'Ready to create'
              : `${photos.length} image${photos.length === 1 ? '' : 's'} selected`}
          </span>
          <button type="button" className="album-upload__btn" disabled={!canFinish || busy} onClick={() => void handleProceed()}>
            {busy ? 'Saving…' : 'Proceed'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
