import React, { useState, useMemo, useCallback } from 'react';
import { Content, Header, Page, InfoCard } from '@backstage/core-components';
import { Grid } from '@material-ui/core';
import { useApi, errorApiRef } from '@backstage/core-plugin-api';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { useProvisioningTasks } from '../../hooks/useProvisioningTasks';
import { useAgents } from '../../hooks/useAgents';
import { TasksList } from './TasksList';
import { AgentList } from '../AgentList';

export const LocalProvisionerPage = () => {
  const api = useApi(localProvisionerApiRef);
  const errorApi = useApi(errorApiRef);
  const [refreshKey, setRefreshKey] = useState(0);
  const { tasks, loading, error } = useProvisioningTasks(refreshKey);
  const { agents, loading: agentsLoading } = useAgents(refreshKey);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);

  // Filter tasks by selected agent
  const filteredTasks = useMemo(() => {
    if (!selectedAgentId) {
      return tasks;
    }
    return tasks.filter(task => task.agentId === selectedAgentId);
  }, [tasks, selectedAgentId]);

  // Calculate task counts per agent for display
  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach(task => {
      counts[task.agentId] = (counts[task.agentId] || 0) + 1;
    });
    return counts;
  }, [tasks]);

  // Get task count for display
  const taskCountDisplay = selectedAgentId
    ? `${filteredTasks.length} ${filteredTasks.length === 1 ? 'task' : 'tasks'} on selected agent`
    : `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} across all agents`;

  const handleDisconnect = useCallback(async (agentId: string) => {
    try {
      await api.disconnectAgent(agentId);
      // Trigger refresh by updating refreshKey
      setRefreshKey(prev => prev + 1);
    } catch (err: any) {
      errorApi.post(new Error(`Failed to disconnect agent: ${err.message}`));
      throw err;
    }
  }, [api, errorApi]);

  const handleRevoke = useCallback(async (agentId: string) => {
    try {
      await api.revokeAgent(agentId);
      // Clear selection if revoking selected agent
      if (agentId === selectedAgentId) {
        setSelectedAgentId(null);
      }
      // Trigger refresh
      setRefreshKey(prev => prev + 1);
    } catch (err: any) {
      errorApi.post(new Error(`Failed to revoke agent: ${err.message}`));
      throw err;
    }
  }, [api, errorApi, selectedAgentId]);

  return (
    <Page themeId="tool">
      <Header
        title="Local Provisioner"
        subtitle="Manage local development resources provisioned to your machine"
      />
      <Content>
        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            <AgentList
              agents={agents}
              loading={agentsLoading}
              selectedAgentId={selectedAgentId}
              onAgentSelect={setSelectedAgentId}
              taskCounts={taskCounts}
              onDisconnect={handleDisconnect}
              onRevoke={handleRevoke}
            />
          </Grid>
          <Grid item xs={12} md={8}>
            <InfoCard title={`Provisioning Tasks (${taskCountDisplay})`}>
              <TasksList tasks={filteredTasks} loading={loading} error={error} />
            </InfoCard>
          </Grid>
        </Grid>
      </Content>
    </Page>
  );
};
