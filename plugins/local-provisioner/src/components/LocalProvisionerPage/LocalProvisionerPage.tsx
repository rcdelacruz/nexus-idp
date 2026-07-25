import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { Content, Header, Page, InfoCard } from '@backstage/core-components';
import {
  Grid,
  Box,
  Button,
  Typography,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  FormControlLabel,
  Checkbox,
} from '@material-ui/core';
import { useApi, alertApiRef } from '@backstage/core-plugin-api';
import { useNavigate } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { ProvisioningTask, Resource } from '../../api/types';
import { useProvisioningTasks } from '../../hooks/useProvisioningTasks';
import { useAgents } from '../../hooks/useAgents';
import { useResources } from '../../hooks/useResources';
import { TasksList, LifecycleAction, resourceKey } from './TasksList';
import { AgentList } from '../AgentList';
import { AgentOnboarding } from '../AgentOnboarding/AgentOnboarding';
import { TaskDetailDrawer } from '../TaskDetails/TaskDetailDrawer';

type Confirm = {
  title: string;
  message: string;
  dataLoss?: boolean;
  action: () => Promise<void>;
};

export const LocalProvisionerPage = () => {
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const navigate = useNavigate();
  const [refreshKey, setRefreshKey] = useState(0);
  const { tasks, loading, error } = useProvisioningTasks(refreshKey);
  const { agents, loading: agentsLoading } = useAgents(refreshKey);
  const { resources } = useResources(refreshKey);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<ProvisioningTask | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [ackChecked, setAckChecked] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Clear selection when the agent filter changes — otherwise "Delete N selected" could
  // reference tasks from a different agent that aren't even visible in the table anymore.
  useEffect(() => {
    setSelectedTaskIds(new Set());
  }, [selectedAgentId]);

  const refresh = useCallback(() => setRefreshKey(prev => prev + 1), []);
  const toast = useCallback(
    (message: string, severity: 'success' | 'error' | 'info' = 'success') =>
      alertApi.post({ message, severity, display: 'transient' }),
    [alertApi],
  );

  const filteredTasks = useMemo(
    () => (selectedAgentId ? tasks.filter(t => t.agentId === selectedAgentId) : tasks),
    [tasks, selectedAgentId],
  );

  const taskCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    tasks.forEach(t => {
      counts[t.agentId] = (counts[t.agentId] || 0) + 1;
    });
    return counts;
  }, [tasks]);

  // Live resource state, keyed by (agentId, resourceName) — for state-aware lifecycle controls.
  const resourceMap = useMemo(() => {
    const map: Record<string, Resource> = {};
    resources.forEach(r => {
      map[resourceKey(r.agentId, r.resourceName)] = r;
    });
    return map;
  }, [resources]);

  // Active (non-removed) resources per agent — used to block deleting/revoking an agent that
  // still owns running or provisioned resources.
  const activeResourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    resources.forEach(r => {
      if (r.state !== 'removed') counts[r.agentId] = (counts[r.agentId] || 0) + 1;
    });
    return counts;
  }, [resources]);

  const taskCountDisplay = selectedAgentId
    ? `${filteredTasks.length} on selected agent`
    : `${tasks.length} across all agents`;

  // Provisioning requires a currently-online agent (heartbeat within 90s). Gate the entry point
  // so users can't start the flow offline only to have the scaffolder run fail at the end.
  const hasOnlineAgent = useMemo(
    () =>
      agents.some(a => {
        const ageSec =
          a.lastSeenAgeSeconds != null
            ? a.lastSeenAgeSeconds
            : (Date.now() - new Date(a.lastSeenAt).getTime()) / 1000;
        return a.isConnected || ageSec <= 90;
      }),
    [agents],
  );

  // Keep the detail drawer's task in sync with fresh data while it polls.
  const liveDetailTask = detailTask
    ? tasks.find(t => t.id === detailTask.id) ?? detailTask
    : null;

  // ---- agent actions ----
  const handleDisconnect = useCallback(
    async (agentId: string) => {
      try {
        await api.disconnectAgent(agentId);
        toast('Agent disconnected');
        refresh();
      } catch (err: any) {
        toast(`Failed to disconnect agent: ${err.message}`, 'error');
      }
    },
    [api, toast, refresh],
  );

  const handleRevoke = useCallback(
    async (agentId: string) => {
      try {
        await api.revokeAgent(agentId);
        if (agentId === selectedAgentId) setSelectedAgentId(null);
        toast('Agent revoked');
        refresh();
      } catch (err: any) {
        toast(`Failed to revoke agent: ${err.message}`, 'error');
      }
    },
    [api, selectedAgentId, toast, refresh],
  );

  // ---- task actions ----
  const handleRetry = useCallback(
    async (task: ProvisioningTask) => {
      try {
        await api.retryTask(task);
        toast('Retrying task');
        refresh();
      } catch (err: any) {
        toast(`Retry failed: ${err.message}`, 'error');
      }
    },
    [api, toast, refresh],
  );

  const handleDispatch = useCallback(
    async (task: ProvisioningTask) => {
      try {
        await api.dispatchTask(task.id);
        toast('Re-sent to agent');
        refresh();
      } catch (err: any) {
        toast(err.message, 'error');
      }
    },
    [api, toast, refresh],
  );

  const handleDelete = useCallback(
    (task: ProvisioningTask) => {
      setAckChecked(false);
      setConfirm({
        title: 'Delete task?',
        message: `Remove task "${task.resourceName}" from the list. This does not stop any running containers.`,
        action: async () => {
          await api.deleteTask(task.id);
          toast('Task deleted');
          refresh();
        },
      });
    },
    [api, toast, refresh],
  );

  const toggleSelect = useCallback((taskId: string) => {
    setSelectedTaskIds(prev => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedTaskIds(prev =>
      prev.size === filteredTasks.length
        ? new Set()
        : new Set(filteredTasks.map(t => t.id)),
    );
  }, [filteredTasks]);

  // Each delete is still guarded server-side (a task representing a resource's current,
  // non-removed state is refused with 409) — this just loops the same single-delete call
  // and reports which ones the server actually accepted.
  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedTaskIds);
    setAckChecked(false);
    setConfirm({
      title: `Delete ${ids.length} task${ids.length === 1 ? '' : 's'}?`,
      message:
        'Remove the selected tasks from the list. This does not stop any running containers. Tasks still representing an active resource will be skipped.',
      action: async () => {
        let deleted = 0;
        let skipped = 0;
        for (const id of ids) {
          try {
            await api.deleteTask(id);
            deleted += 1;
          } catch {
            skipped += 1;
          }
        }
        setSelectedTaskIds(new Set());
        refresh();
        if (skipped === 0) {
          toast(`Deleted ${deleted} task${deleted === 1 ? '' : 's'}`);
        } else {
          toast(`Deleted ${deleted}, skipped ${skipped} — still active`, 'info');
        }
      },
    });
  }, [api, selectedTaskIds, toast, refresh]);

  const handleLifecycle = useCallback(
    (task: ProvisioningTask, action: LifecycleAction) => {
      if (action === 'deprovision') {
        setAckChecked(false);
        setConfirm({
          title: 'Stop & remove resource?',
          message: `This runs "docker-compose down -v" for "${task.resourceName}" on the agent, permanently deleting its containers and data volumes.`,
          dataLoss: true,
          action: async () => {
            await api.lifecycleAction(task, 'deprovision');
            toast('Teardown queued');
            refresh();
          },
        });
        return;
      }
      api
        .lifecycleAction(task, action)
        .then(() => {
          toast(`${action} queued`);
          refresh();
        })
        .catch((err: any) => toast(`${action} failed: ${err.message}`, 'error'));
    },
    [api, toast, refresh],
  );


  const runConfirm = async () => {
    if (!confirm) return;
    try {
      await confirm.action();
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setConfirm(null);
    }
  };

  return (
    <Page themeId="tool">
      <Header
        title="Local Provisioner"
        subtitle="Run local development resources on your machine"
      />
      <Content>
        <Box
          display="flex"
          alignItems="center"
          justifyContent="flex-end"
          style={{ marginBottom: 16, gap: 12 }}
        >
          {!hasOnlineAgent && (
            <Typography variant="body2" style={{ color: '#d97706' }}>
              Start your agent to provision — <code>backstage-agent start</code>
            </Typography>
          )}
          <Tooltip
            title={
              hasOnlineAgent
                ? ''
                : 'No online agent. Run `backstage-agent start` on the machine where you want the resource.'
            }
          >
            {/* span wrapper so the tooltip still shows on a disabled button */}
            <span>
              <Button
                color="primary"
                variant="contained"
                disabled={!hasOnlineAgent}
                startIcon={<Plus size={16} strokeWidth={2} />}
                onClick={() =>
                  navigate(
                    '/create?filters%5Bkind%5D=template&filters%5Btype%5D=training&filters%5Buser%5D=all&trainingAccess=1',
                  )
                }
              >
                Provision resource
              </Button>
            </span>
          </Tooltip>
        </Box>

        <Grid container spacing={3}>
          <Grid item xs={12} md={4}>
            {!agentsLoading && agents.length === 0 ? (
              <AgentOnboarding />
            ) : (
              <AgentList
                agents={agents}
                loading={agentsLoading}
                selectedAgentId={selectedAgentId}
                onAgentSelect={setSelectedAgentId}
                taskCounts={taskCounts}
                activeResourceCounts={activeResourceCounts}
                onDisconnect={handleDisconnect}
                onRevoke={handleRevoke}
              />
            )}
          </Grid>
          <Grid item xs={12} md={8}>
            <InfoCard
              title={`Provisioning Tasks (${taskCountDisplay})`}
              action={
                selectedTaskIds.size > 0 ? (
                  <Button
                    size="small"
                    startIcon={<Trash2 size={14} strokeWidth={1.5} />}
                    style={{ color: '#e5484d' }}
                    onClick={handleBulkDelete}
                  >
                    Delete {selectedTaskIds.size} selected
                  </Button>
                ) : undefined
              }
            >
              <TasksList
                tasks={filteredTasks}
                resources={resourceMap}
                loading={loading}
                error={error}
                onView={setDetailTask}
                onDelete={handleDelete}
                onRetry={handleRetry}
                onDispatch={handleDispatch}
                onLifecycle={handleLifecycle}
                selectedTaskIds={selectedTaskIds}
                onToggleSelect={toggleSelect}
                onToggleSelectAll={toggleSelectAll}
              />
            </InfoCard>
          </Grid>
        </Grid>
      </Content>

      <TaskDetailDrawer task={liveDetailTask} onClose={() => setDetailTask(null)} />

      <Dialog open={Boolean(confirm)} onClose={() => setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm?.message}</DialogContentText>
          {confirm?.dataLoss && (
            <FormControlLabel
              control={
                <Checkbox
                  checked={ackChecked}
                  onChange={e => setAckChecked(e.target.checked)}
                  color="primary"
                />
              }
              label="I understand this permanently deletes the data."
            />
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirm(null)}>Cancel</Button>
          <Button
            onClick={runConfirm}
            disabled={confirm?.dataLoss && !ackChecked}
            style={{ color: '#e5484d' }}
          >
            {confirm?.dataLoss ? 'Delete' : 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </Page>
  );
};
