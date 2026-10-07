import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app';

import 'lenis/dist/lenis.css';
import './index.css';

/** VITE_GRAYSCALE=true (default) → B&W; false → color images. */
const grayscaleOn = String(import.meta.env.VITE_GRAYSCALE ?? 'true').trim().toLowerCase() !== 'false';
document.documentElement.classList.toggle('site-grayscale', grayscaleOn);
document.documentElement.classList.toggle('site-color', !grayscaleOn);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
