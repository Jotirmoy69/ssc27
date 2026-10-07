import { useEffect, type RefObject } from 'react';
import Lenis from 'lenis';

/** Shared Lenis feel for the whole app. */
export const SMOOTH_SCROLL = {
  lerp: 0.085,
  duration: 1.15,
  smoothWheel: true,
  syncTouch: true,
  touchMultiplier: 1.35,
  wheelMultiplier: 0.95,
  orientation: 'vertical' as const,
  gestureOrientation: 'vertical' as const,
};

/**
 * Attach Lenis smooth scrolling to a scrollable element.
 * Pass the overflow wrapper as `wrapperRef` (and optionally an inner content ref).
 */
export function useSmoothScroll(
  wrapperRef: RefObject<HTMLElement | null>,
  options?: {
    contentRef?: RefObject<HTMLElement | null>;
    enabled?: boolean;
    /** When true, drive RAF via GSAP ticker yourself — leave false for nested panels. */
    manualRaf?: boolean;
  },
) {
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper || options?.enabled === false) return;

    const lenis = new Lenis({
      ...SMOOTH_SCROLL,
      wrapper,
      content: options?.contentRef?.current ?? undefined,
      autoRaf: !options?.manualRaf,
    });

    return () => {
      lenis.destroy();
    };
  }, [wrapperRef, options?.contentRef, options?.enabled, options?.manualRaf]);
}
