import { useEffect, useState } from 'react';
import { SquiCircleFilterStatic } from '@/components/ui/skiper-ui/skiper63';
import PagePreloader from '@/components/ui/smoothui/page-preloader';
import { AuthChip } from './auth/auth-chip';
import { AuthProvider } from './auth/auth-context';
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
    <AuthProvider>
      <div className="relative h-full w-full">
        <SquiCircleFilterStatic />
        <PagePreloader
          variant="stairs"
          background="bg-black"
          active={preloading}
          columns={6}
          startCovered
        />
        <AuthChip />
        <Projects /> 
      </div>
    </AuthProvider>
  );
}
