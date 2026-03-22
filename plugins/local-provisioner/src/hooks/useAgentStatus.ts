import { useEffect, useState } from 'react';
import { useApi } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../api/LocalProvisionerClient';
import { AgentRegistration } from '../api/types';

export function useAgentStatus() {
  const api = useApi(localProvisionerApiRef);
  const [agent, setAgent] = useState<AgentRegistration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let mounted = true;

    const fetchAgentStatus = async () => {
      try {
        setLoading(true);
        const fetchedAgent = await api.getAgentStatus();
        if (mounted) {
          setAgent(fetchedAgent);
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err as Error);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };

    fetchAgentStatus();

    // Poll for updates every 30 seconds
    const interval = setInterval(fetchAgentStatus, 30000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [api]);

  return { agent, loading, error };
}
