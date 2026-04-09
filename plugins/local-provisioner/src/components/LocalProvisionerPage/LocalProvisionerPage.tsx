import React, { useState, useMemo, useCallback } from 'react';
import { Content, Header, Page, InfoCard, ErrorPanel } from '@backstage/core-components';
import { Grid, Box, Typography } from '@material-ui/core';
import { useApi } from '@backstage/core-plugin-api';
import { Construction } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { useProvisioningTasks } from '../../hooks/useProvisioningTasks';
import { useAgents } from '../../hooks/useAgents';
import { TasksList } from './TasksList';
import { AgentList } from '../AgentList';

export const LocalProvisionerPage = () => {
  const api = useApi(localProvisionerApiRef);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pageError, setPageError] = useState<Error | null>(null);
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
      setPageError(new Error(`Failed to disconnect agent: ${err.message}`));
    }
  }, [api]);

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
      setPageError(new Error(`Failed to revoke agent: ${err.message}`));
    }
  }, [api, selectedAgentId]);

  const c = useColors();

  return (
    <Page themeId="tool">
      <Header
        title="Local Provisioner"
        subtitle="Manage local development resources provisioned to your machine"
      />
      <Content>
        {pageError && (
          <Box style={{ marginBottom: 16 }}>
            <ErrorPanel error={pageError} titleFormat="markdown" title={pageError.message} />
          </Box>
        )}

        <Box
          display="flex" alignItems="flex-start"
          style={{
            background: c.surfaceSubtle,
            border: `1px solid ${c.border}`,
            borderRadius: 8,
            padding: '12px 16px',
            marginBottom: 20,
            gap: 10,
          }}
        >
          <Construction size={16} color={c.textMuted} strokeWidth={1.5} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
          <Typography style={{ fontSize: '0.8125rem', color: c.textMuted }}>
            This page is under construction. The Local Provisioner is being restructured as a standalone installable plugin.
          </Typography>
        </Box>
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
