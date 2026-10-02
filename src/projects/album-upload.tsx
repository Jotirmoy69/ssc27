import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { gsap } from 'gsap';
import { compressToWebP } from '../api/compress-image';
import { imageUrl, uploadWebP } from '../api/school-memories';

export type UploadedAlbum = {
  person: string;
  cover: string;
  photos: string[];
};

type AlbumUploadProps = {
  onClose: () => void;
  onComplete: (album: UploadedAlbum) => void;
};

type PreviewItem = {
  id: string;
  preview: string;
  remoteUrl?: string;
};

function UploadPlusIcon() {
  return (
    <span className="album-upload__plus" aria-hidden="true">
      <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="28" cy="28" r="26.5" stroke="currentColor" strokeWidth="1.5" strokeDasharray="2.5 3.5" />
        <path d="M28 17v22M17 28h22" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

async function uploadFile(file: File): Promise<{ preview: string; remoteUrl: string }> {
  const preview = URL.createObjectURL(file);
  const webp = await compressToWebP(file);
  const result = await uploadWebP(webp, `${file.name.replace(/\.[^.]+$/, '') || 'memory'}.webp`);
  const remoteUrl = imageUrl(
    result.url ?? (result.key ? `/api/image?key=${encodeURIComponent(result.key)}` : ''),
  );
  if (!remoteUrl) throw new Error('Upload succeeded but no image URL was returned');
  return { preview, remoteUrl };
}

export function AlbumUpload({ onClose, onComplete }: AlbumUploadProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [person, setPerson] = useState('');
  const [cover, setCover] = useState<PreviewItem | null>(null);
  const [photos, setPhotos] = useState<PreviewItem[]>([]);
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
      if (cover?.preview.startsWith('blob:')) URL.revokeObjectURL(cover.preview);
      photos.forEach((photo) => {
        if (photo.preview.startsWith('blob:')) URL.revokeObjectURL(photo.preview);
      });
    };
  }, [cover, photos]);

  const handleCover = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    setStatus('Compressing & uploading cover…');
    try {
      const uploaded = await uploadFile(files[0]);
      setCover({
        id: crypto.randomUUID(),
        preview: uploaded.preview,
        remoteUrl: uploaded.remoteUrl,
      });
      setStatus('Cover uploaded');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Cover upload failed');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const handlePhotos = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      const list = Array.from(files);
      const uploadedItems: PreviewItem[] = [];

      for (let index = 0; index < list.length; index += 1) {
        setStatus(`Uploading album image ${index + 1} of ${list.length}…`);
        const uploaded = await uploadFile(list[index]);
        uploadedItems.push({
          id: crypto.randomUUID(),
          preview: uploaded.preview,
          remoteUrl: uploaded.remoteUrl,
        });
      }

      setPhotos((prev) => [...prev, ...uploadedItems]);
      setStatus(`Uploaded ${list.length} album image${list.length === 1 ? '' : 's'}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Album upload failed');
      setStatus('');
    } finally {
      setBusy(false);
    }
  };

  const canFinish = Boolean(cover?.remoteUrl) && photos.some((photo) => photo.remoteUrl);

  return createPortal(
    <div
      ref={rootRef}
      className="album-upload"
      role="dialog"
      aria-modal="true"
      aria-label="Upload album"
      onClick={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <div className="album-upload__card">
        <header className="album-upload__header">
          <div>
            <h2 className="album-upload__title">Upload album</h2>
            <p className="album-upload__subtitle">
              Images are compressed to WebP and stored via the School Memories API.
            </p>
          </div>
          <button
            type="button"
            className="album-upload__close"
            onClick={onClose}
            disabled={busy}
            aria-label="Close upload"
          >
            Close
          </button>
        </header>

        <div className="album-upload__body">
          <label className="album-upload__field">
            <span>Person / album name</span>
            <input
              type="text"
              value={person}
              onChange={(event) => setPerson(event.target.value)}
              placeholder="e.g. Jotirmoy"
              disabled={busy}
            />
          </label>

          <section className="album-upload__section">
            <div className="album-upload__section-head">
              <h3>1. Cover poster</h3>
              <p>Shown on the homepage box with the eye hover.</p>
            </div>

            <label className={`album-upload__drop${cover ? ' has-file' : ''}`}>
              <input
                type="file"
                accept="image/*"
                hidden
                disabled={busy}
                onChange={(event) => {
                  void handleCover(event.target.files);
                  event.target.value = '';
                }}
              />
              {cover ? (
                <img src={cover.preview} alt="Cover preview" className="album-upload__preview" draggable={false} />
              ) : (
                <span className="album-upload__drop-label">
                  <UploadPlusIcon />
                  Choose cover poster
                </span>
              )}
            </label>
          </section>

          <section className="album-upload__section">
            <div className="album-upload__section-head">
              <h3>2. Album images</h3>
              <p>Multiple photos for the album grid.</p>
            </div>

            <label className="album-upload__drop album-upload__drop--multi">
              <input
                type="file"
                accept="image/*"
                multiple
                hidden
                disabled={busy}
                onChange={(event) => {
                  void handlePhotos(event.target.files);
                  event.target.value = '';
                }}
              />
              <span className="album-upload__drop-label">
                <UploadPlusIcon />
                Add multiple images
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
                      onClick={() => setPhotos((prev) => prev.filter((item) => item.id !== photo.id))}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {status ? <p className="album-upload__status">{status}</p> : null}
          {error ? <p className="album-upload__error">{error}</p> : null}
        </div>

        <footer className="album-upload__footer">
          <span className="album-upload__hint">
            {cover?.remoteUrl ? 'Cover ready' : 'Cover needed'} ·{' '}
            {photos.filter((photo) => photo.remoteUrl).length} image
            {photos.filter((photo) => photo.remoteUrl).length === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className="album-upload__btn"
            disabled={!canFinish || busy}
            onClick={() => {
              if (!cover?.remoteUrl) return;
              const remotePhotos = photos.map((photo) => photo.remoteUrl).filter(Boolean) as string[];
              if (!remotePhotos.length) return;
              onComplete({
                person: person.trim() || 'Untitled',
                cover: cover.remoteUrl,
                photos: remotePhotos,
              });
            }}
          >
            {busy ? 'Uploading…' : 'Create album'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}
