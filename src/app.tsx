import { useEffect, useState } from 'react';
import { Agentation } from 'agentation';
import { SmoothCursor } from '@/components/ui/smooth-cursor';
import { SquiCircleFilterStatic } from '@/components/ui/skiper-ui/skiper63';
import DrawingCursor from '@/components/ui/smoothui/drawing-cursor';
import PagePreloader from '@/components/ui/smoothui/page-preloader';
import { preloadSchoolMemories } from './api/preload-school-memories';
import { Projects } from './projects';

const MIN_HOLD_MS = 1000;

export function App() {
  const [preloading, setPreloading] = useState(true);

  useEffect(() => {
    let alive = true;

    Promise.all([
      preloadSchoolMemories().catch(() => [] as string[]),
      new Promise<void>((resolve) => setTimeout(resolve, MIN_HOLD_MS)),
    ]).finally(() => {
      if (alive) setPreloading(false);
    });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <DrawingCursor
      className="h-full w-full"
      color="#222222"
      lineWidth={2.5}
      decay={900}
      clearOnLeave={false}
    >
      <SquiCircleFilterStatic />
      <SmoothCursor />
      <PagePreloader
        variant="stairs"
        background="bg-black"
        active={preloading}
        columns={6}
        startCovered
      />
      <Projects />
      <Agentation />
    </DrawingCursor>
  );
}
