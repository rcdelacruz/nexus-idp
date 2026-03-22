import { useEffect, useState, useRef } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import { ProvisioningTask } from '../api/types';

/**
 * Deep comparison helper to check if task data actually changed
 */
function tasksChanged(
  prev: ProvisioningTask[],
  next: ProvisioningTask[]
): boolean {
  if (prev.length !== next.length) return true;

  // Compare each task's relevant fields
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const n = next[i];

    if (
      p.id !== n.id ||
      p.status !== n.status ||
      p.updatedAt !== n.updatedAt ||
      p.errorMessage !== n.errorMessage
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Hook to fetch provisioning tasks for the current user
 * Polls every 3 seconds to keep task status up-to-date
 * Only triggers re-render when data actually changes (prevents modal pulsing)
 *
 * @param refreshKey - Optional key to trigger manual refresh (increment to refresh)
 */
export function useProvisioningTasks(refreshKey?: number) {
  const api = useApi(localProvisionerApiRef);
  const [tasks, setTasks] = useState<ProvisioningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const previousTasksRef = useRef<ProvisioningTask[]>([]);

  useEffect(() => {
    let mounted = true;
    let isFirstFetch = true;

    const fetchTasks = async () => {
      try {
        // Only show loading on first fetch, not on polls
        if (isFirstFetch && mounted) {
          setLoading(true);
        }

        const fetchedTasks = await api.getTasks();

        if (mounted) {
          // Only update state if data actually changed
          if (
            isFirstFetch ||
            tasksChanged(previousTasksRef.current, fetchedTasks)
          ) {
            setTasks(fetchedTasks);
            previousTasksRef.current = fetchedTasks;
          }
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      } finally {
        if (mounted && isFirstFetch) {
          setLoading(false);
          isFirstFetch = false;
        }
      }
    };

    fetchTasks();

    // Poll for updates every 3 seconds to quickly reflect CLI/UI changes
    const interval = setInterval(fetchTasks, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [api, refreshKey]);

  return { tasks, loading, error };
}
