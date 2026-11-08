import { useCallback, useEffect, useState } from 'react';
import { Radar } from './radarModel';
import { loadLatestRadar } from './radarSource';

export type RadarState =
  | { status: 'loading' }
  | { status: 'ready'; radar: Radar; stale: boolean }
  | { status: 'error'; message: string };

/** Loads the radar once per mount; `retry` loads it again. */
export function useRadar(): RadarState & { retry: () => void } {
  const [state, setState] = useState<RadarState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: 'loading' });
    loadLatestRadar({}, controller.signal)
      .then(({ radar, stale }) => setState({ status: 'ready', radar, stale }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setState({ status: 'error', message: error?.message ?? 'The radar could not be loaded' });
      });
    return () => controller.abort();
  }, [attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { ...state, retry };
}
