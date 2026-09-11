// Study — DEV-only mount/render timing probe.
//
// No-op in production builds. In dev, logs `<name> mounted in <ms>ms` so
// heavy routes (Manage, Exam Prep Learn) can be profiled in the console
// without shipping instrumentation.
import { useEffect, useRef } from 'react';

export const useDevMountTiming = (name: string): void => {
  const start = useRef(0);
  // eslint-disable-next-line react-hooks/purity -- DEV-only clock read for perf logging, never rendered
  if (start.current === 0) start.current = performance.now();
  useEffect(() => {
    if (import.meta.env.DEV) {
      console.log(
        `[study-perf] ${name} mounted in ${(performance.now() - start.current).toFixed(1)}ms`,
      );
    }
  }, [name]);
};
