import { useEffect, useState, useRef } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import { Resource } from '../api/types';

/**
 * Deep comparison helper to check if resource data actually changed
 */
function resourcesChanged(prev: Resource[], next: Resource[]): boolean {
  if (prev.length !== next.length) return true;

  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const n = next[i];

    if (
      p.resourceName !== n.resourceName ||
      p.agentId !== n.agentId ||
      p.state !== n.state ||
      p.updatedAt !== n.updatedAt
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Hook to fetch the resource-centric (folded) view of the current user's provisioned resources
 * — each resource's live lifecycle state (running/stopped/etc.), not a historical task row.
 * Polls every 3 seconds, same cadence as `useProvisioningTasks`, so the two stay in sync.
 *
 * @param refreshKey - Optional key to trigger manual refresh (increment to refresh)
 */
export function useResources(refreshKey?: number) {
  const api = useApi(localProvisionerApiRef);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const previousResourcesRef = useRef<Resource[]>([]);

  useEffect(() => {
    let mounted = true;
    let isFirstFetch = true;

    const fetchResources = async () => {
      try {
        if (isFirstFetch && mounted) {
          setLoading(true);
        }

        const fetchedResources = await api.getResources();

        if (mounted) {
          if (
            isFirstFetch ||
            resourcesChanged(previousResourcesRef.current, fetchedResources)
          ) {
            setResources(fetchedResources);
            previousResourcesRef.current = fetchedResources;
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

    fetchResources();

    const interval = setInterval(fetchResources, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [api, refreshKey]);

  return { resources, loading, error };
}
