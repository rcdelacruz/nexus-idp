import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import { ActivityQueue } from '../components/TraineesPage/activityQueue';

/**
 * The GitHub activity queue of the Trainees page, tied to the page's life. `version` changes whenever an entry does, so a component
 * that reads the queue during render is rendered again. The queue is made after mount (and replaced if the page is mounted again),
 * so it is `null` for the first render.
 */
export function useTraineeActivity(): { queue: ActivityQueue | null; version: number } {
  const api = useApi(localProvisionerApiRef);
  const [queue, setQueue] = useState<ActivityQueue | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const q = new ActivityQueue({
      fetchChunk: (keys, refresh) => api.getTraineeActivity(keys, 'brief', refresh),
      onChange: () => setVersion(v => v + 1),
    });
    setQueue(q);
    return () => q.dispose();
  }, [api]);

  return { queue, version };
}
