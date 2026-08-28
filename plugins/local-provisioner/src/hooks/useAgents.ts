import { useEffect, useState, useRef } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import { AgentRegistration } from '../api/types';
import { getConnectivity } from '../api/connectivity';

/**
 * Deep comparison helper to check if agent data actually changed.
 *
 * Includes the derived connectivity bucket (online/degraded/offline), not just raw fields —
 * lastSeenAt freezes once an agent stops heartbeating/polling, so comparing only raw fields
 * meant the bucket could silently shift underneath a component that never re-rendered to show
 * it, forcing a manual page refresh to see the current status (found 2026-07-26).
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
      p.machineName !== n.machineName ||
      getConnectivity(p) !== getConnectivity(n)
    ) {
      return true;
    }
  }

  return false;
}

const NORMAL_POLL_MS = 3000;
// After a user-initiated action (Stop Agent), poll fast for a window so the real state change
// — whichever path actually delivers it, SSE (near-instant when the tunnel cooperates) or the
// heartbeat fallback (up to 30s, since Cloudflare's free tunnel doesn't reliably keep SSE
// alive) — shows up as soon as it's genuinely true, not on the next lazy 3s tick.
const FAST_POLL_MS = 1000;
const FAST_POLL_WINDOW_MS = 35000; // covers one full heartbeat cycle with margin

/**
 * Hook to fetch all agents for the current user
 * Polls every 3 seconds to keep agent status up-to-date (or every 1s during fastPollFor's
 * window after a user-initiated action).
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
  const fastPollUntilRef = useRef<number>(0);

  /** Switch to 1s polling for FAST_POLL_WINDOW_MS — call right after Stop/Start Agent. */
  const fastPollFor = (ms: number = FAST_POLL_WINDOW_MS) => {
    fastPollUntilRef.current = Date.now() + ms;
  };

  useEffect(() => {
    let mounted = true;
    let isFirstFetch = true;
    let timer: ReturnType<typeof setTimeout>;

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

      if (mounted) {
        const delay = Date.now() < fastPollUntilRef.current ? FAST_POLL_MS : NORMAL_POLL_MS;
        timer = setTimeout(fetchAgents, delay);
      }
    };

    fetchAgents();

    return () => {
      mounted = false;
      clearTimeout(timer);
    };
  }, [api, refreshKey]);

  return { agents, loading, error, fastPollFor };
}
