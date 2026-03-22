import { useEffect, useState, useRef } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import { AgentRegistration } from '../api/types';

/**
 * Deep comparison helper to check if agent data actually changed
 */
function agentsChanged(
  prev: AgentRegistration[],
  next: AgentRegistration[]
): boolean {
  if (prev.length !== next.length) return true;

  // Compare each agent's relevant fields
  for (let i = 0; i < prev.length; i++) {
    const p = prev[i];
    const n = next[i];

    if (
      p.id !== n.id ||
      p.isConnected !== n.isConnected ||
      p.lastSeenAt !== n.lastSeenAt ||
      p.hostname !== n.hostname ||
      p.machineName !== n.machineName
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Hook to fetch all agents for the current user
 * Polls every 3 seconds to keep agent status up-to-date
 * Only triggers re-render when data actually changes (prevents modal pulsing)
 *
 * @param refreshKey - Optional key to trigger manual refresh (increment to refresh)
 */
export function useAgents(refreshKey?: number) {
  const api = useApi(localProvisionerApiRef);
  const [agents, setAgents] = useState<AgentRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const previousAgentsRef = useRef<AgentRegistration[]>([]);

  useEffect(() => {
    let mounted = true;
    let isFirstFetch = true;

    const fetchAgents = async () => {
      try {
        // Only show loading on first fetch, not on polls
        if (isFirstFetch && mounted) {
          setLoading(true);
        }

        const fetchedAgents = await api.getAgents();

        if (mounted) {
          // Only update state if data actually changed
          if (
            isFirstFetch ||
            agentsChanged(previousAgentsRef.current, fetchedAgents)
          ) {
            setAgents(fetchedAgents);
            previousAgentsRef.current = fetchedAgents;
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

    fetchAgents();

    // Poll for updates every 3 seconds to quickly reflect CLI changes
    // (logout, stop, etc. should appear in UI almost immediately)
    const interval = setInterval(fetchAgents, 3000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [api, refreshKey]);

  return { agents, loading, error };
}
