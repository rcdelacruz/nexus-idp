import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
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
  IconButton,
  Portal,
  Snackbar,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi, alertApiRef } from '@backstage/core-plugin-api';
import { useLocation, useNavigate } from 'react-router-dom';
import { ExternalLink, GraduationCap, Plus, Trash2, X } from 'lucide-react';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { LabConflict, ProvisioningTask, Resource, RetryLeftover, isCheckTask } from '../../api/types';
import { describeConflicts, removeConflictsThenRetry, removeLeftoverThenRetry } from '../../api/retryWithReplacement';
import { getConnectivity } from '../../api/connectivity';
import { LOCAL_PROVISIONER_PATH, parseLabTaskPath } from '../../api/labTaskPath';
import { isJustCreated } from '../../api/labArrival';
import { agentWorkspace, invitationUrl, repoReachedByMountedLab } from '../../api/cloneInfo';
import { useProvisioningTasks } from '../../hooks/useProvisioningTasks';
import { useAgents } from '../../hooks/useAgents';
import { useResources } from '../../hooks/useResources';
import { TasksList, LifecycleAction, resourceKey } from './TasksList';
import { AgentList } from '../AgentList';
import { AgentOnboarding } from '../AgentOnboarding/AgentOnboarding';
import { TaskDetailDrawer } from '../TaskDetails/TaskDetailDrawer';

/** The training-template wizard (trainingAccess=1 lifts the Create page's training filter). */
const TRAINING_CATALOG_URL =
  '/create?filters%5Bkind%5D=template&filters%5Btype%5D=training&filters%5Buser%5D=all&trainingAccess=1';

type Confirm = {
  title: string;
  message: string;
  dataLoss?: boolean;
  /** Replaces the default button text. */
  confirmLabel?: string;
  /** `report` shows what a long action is doing in the dialog. */
  action: (report: (message: string) => void) => Promise<void>;
};

export const LocalProvisionerPage = () => {
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const navigate = useNavigate();
  const location = useLocation();
  // The lab named in the URL (/local-provisioner/tasks/<id>): where the Create run page sends you
  // when your lab has been queued. Its drawer is open for as long as the URL names it.
  const urlTaskId = parseLabTaskPath(location.pathname);
  const [refreshKey, setRefreshKey] = useState(0);
  const { tasks, loading, error } = useProvisioningTasks(refreshKey);
  const { agents, loading: agentsLoading } = useAgents(refreshKey);
  const { resources } = useResources(refreshKey);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<ProvisioningTask | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [ackChecked, setAckChecked] = useState(false);
  /** What the confirmed action is doing right now; set while it runs. */
  const [confirmBusy, setConfirmBusy] = useState<string | null>(null);
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

  // Provisioning requires a currently-online agent (the server's verdict: polled within ~45s and
  // not known to have stopped). Gate the entry point
  // so users can't start the flow offline only to have the scaffolder run fail at the end.
  const hasOnlineAgent = useMemo(
    () => agents.some(a => getConnectivity(a) === 'online'),
    [agents],
  );

  // Keep the detail drawer's task in sync with fresh data while it polls.
  const liveDetailTask = detailTask
    ? tasks.find(t => t.id === detailTask.id) ?? detailTask
    : null;

  // The lab named in the URL, from the full list (the agent filter must not hide it). It is read
  // from the list on every render, so the drawer stays live like a row-opened one.
  const urlTask = urlTaskId ? tasks.find(t => t.id === urlTaskId) : undefined;
  const drawerTask = urlTask ?? liveDetailTask;

  // A URL that names no lab of yours (a typo, a removed task, someone else's id, which the list
  // never contains) is cleared. The message is posted once, and only when the lab was never found
  // here: a lab that goes away while you look at it just closes. Nothing is decided while the list
  // is loading or failed to load.
  const foundLab = useRef<string | null>(null);
  const missingLab = useRef<string | null>(null);
  useEffect(() => {
    if (!urlTaskId) {
      foundLab.current = null;
      missingLab.current = null;
      return;
    }
    if (urlTask) {
      foundLab.current = urlTaskId;
      return;
    }
    if (loading || error || missingLab.current === urlTaskId) return;
    missingLab.current = urlTaskId;
    if (foundLab.current !== urlTaskId) {
      alertApi.post({
        message: 'That lab is not in your list. It may have been removed.',
        severity: 'warning',
        display: 'transient',
      });
    }
    navigate(LOCAL_PROVISIONER_PATH, { replace: true });
  }, [urlTaskId, urlTask, loading, error, alertApi, navigate]);

  // Closing a drawer opened from the URL also leaves that URL, so a refresh or Back does not open it again.
  const closeDrawer = useCallback(() => {
    setDetailTask(null);
    if (urlTaskId) navigate(LOCAL_PROVISIONER_PATH, { replace: true });
  }, [urlTaskId, navigate]);

  // You were just sent here by a successful Create run: greet the new lab once. A lab with a GitHub repo
  // gets a toast with the link to accept the invitation (without it the lab cannot get your code, and a
  // Node.js lab, which waits for the code, gives up after 30 minutes); any other lab just a short note.
  // The mark is removed straight away, so a reload, Back or a shared link never repeats the greeting.
  const [inviteToast, setInviteToast] = useState<{ taskId: string; url: string; waits: boolean } | null>(null);
  const greeted = useRef<string | null>(null);
  useEffect(() => {
    if (!urlTask || !isJustCreated(location.state) || greeted.current === urlTask.id) return;
    greeted.current = urlTask.id;
    const url = invitationUrl((urlTask.config as { githubRepoUrl?: string } | undefined)?.githubRepoUrl);
    if (url) {
      setInviteToast({ taskId: urlTask.id, url, waits: (urlTask.config as { workspaceMount?: unknown } | undefined)?.workspaceMount === true });
    } else {
      alertApi.post({ message: 'Your lab is queued on your laptop.', severity: 'success', display: 'transient' });
    }
    navigate(location.pathname, { replace: true, state: null });
  }, [urlTask, location.state, location.pathname, alertApi, navigate]);
  // The toast goes away once its premise is gone: the lab has your code (reported at the end, or — for a lab
  // that mounts the repo — a step past the wait is running), failed, or was removed.
  const toastTask = inviteToast ? tasks.find(t => t.id === inviteToast.taskId) : undefined;
  const codeArrived =
    ['cloned', 'existing'].includes(agentWorkspace(toastTask?.metadata)?.status ?? '') || (toastTask ? repoReachedByMountedLab(toastTask) : false);
  // Removed = its teardown (a deprovision task newer than the lab's own) has completed. A removed lab is not in
  // the resources list at all (GET /tasks/resources leaves removed labs out), so the task list is where it shows.
  const toastLabGone =
    toastTask !== undefined &&
    (toastTask.status === 'failed' ||
      tasks.some(
        t =>
          t.taskType === 'deprovision' &&
          t.status === 'completed' &&
          t.agentId === toastTask.agentId &&
          t.resourceName === toastTask.resourceName &&
          Date.parse(t.createdAt) > Date.parse(toastTask.createdAt),
      ));
  const showInviteToast = Boolean(inviteToast && toastTask && !codeArrived && !toastLabGone);

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
  /** Task ids whose Retry is running (the plan is read, a leftover is removed and awaited first): a second click must not start another. */
  const retrying = useRef<Set<string>>(new Set());
  const handleRetry = useCallback(
    async (task: ProvisioningTask) => {
      if (retrying.current.has(task.id)) {
        toast('This task is already being retried', 'info');
        return;
      }
      retrying.current.add(task.id);
      let leftover: RetryLeftover | null = null;
      try {
        // Another of the user's labs may hold a port this one needs (a port can be held by one
        // container only), or a failed VM lab may have left its half-made VM. If that can't be
        // checked, retry as before.
        let conflicts: LabConflict[] = [];
        try {
          ({ conflicts, leftover } = await api.getRetryPlan(task.id));
        } catch {
          conflicts = [];
          leftover = null;
        }
        if (conflicts.length > 0) {
          setAckChecked(false);
          setConfirm({
            title:
              conflicts.length === 1
                ? `Remove "${conflicts[0].resourceName}" and retry?`
                : `Remove ${conflicts.length} labs and retry?`,
            message: describeConflicts(task, conflicts),
            dataLoss: true,
            confirmLabel: 'Remove and retry',
            action: async report => {
              await removeConflictsThenRetry(api, task, conflicts, report);
              toast('Retrying task');
              refresh();
            },
          });
          return;
        }
        if (leftover) {
          toast('Removing the unfinished VM from the failed attempt…', 'info');
          await removeLeftoverThenRetry(api, task, leftover);
        } else {
          await api.retryTask(task);
        }
        toast('Retrying task');
        refresh();
      } catch (err: any) {
        toast(leftover ? err.message : `Retry failed: ${err.message}`, 'error');
      } finally {
        retrying.current.delete(task.id);
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

  // Instructor checks are not the trainee's to delete: "select all" never includes them.
  const toggleSelectAll = useCallback(() => {
    const selectable = filteredTasks.filter(t => !isCheckTask(t));
    setSelectedTaskIds(prev => (prev.size === selectable.length ? new Set() : new Set(selectable.map(t => t.id))));
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
          toast(
            `Deleted ${deleted}, kept ${skipped}: ${skipped === 1 ? 'its lab still exists' : 'their labs still exist'}. Remove the lab first (⋮ → Stop & remove, or Cancel & remove while it is setting up).`,
            'info',
          );
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
    if (!confirm || confirmBusy) return;
    setConfirmBusy('Working…');
    try {
      await confirm.action(setConfirmBusy);
    } catch (err: any) {
      toast(err.message, 'error');
    } finally {
      setConfirmBusy(null);
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
          {/* Capstones such as the Node.js one need no agent, so browsing trainings is never gated on one. */}
          <Button
            variant="outlined"
            startIcon={<GraduationCap size={16} strokeWidth={1.5} />}
            onClick={() => navigate(TRAINING_CATALOG_URL)}
          >
            Browse trainings &amp; capstones
          </Button>
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
                onClick={() => navigate(TRAINING_CATALOG_URL)}
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
                    data-destructive
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

      {showInviteToast && inviteToast && (
        // In a portal on <body>, like the portal's other toasts: the open drawer is a modal, which hides
        // everything inside the page from assistive technology, including a toast rendered here. At the
        // bottom, because it stays up until dismissed and the stock toasts (errors from Retry, Remove...) are
        // top-centre at the same height and would be covered by it.
        <Portal>
        <Snackbar open anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}>
          <Alert
            severity="info"
            action={
              <>
                <Button
                  color="inherit"
                  size="small"
                  href={inviteToast.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  endIcon={<ExternalLink size={14} strokeWidth={1.5} />}
                  onClick={() => setInviteToast(null)}
                >
                  Accept the invitation
                </Button>
                <IconButton color="inherit" size="small" aria-label="dismiss" onClick={() => setInviteToast(null)}>
                  <X size={16} strokeWidth={1.5} />
                </IconButton>
              </>
            }
          >
            <Typography component="span">
              Your lab is queued on your laptop. Accept the GitHub invitation to your repo (if you haven't yet) so the lab can
              get your code.
              {inviteToast.waits ? ' This lab waits 30 minutes for it, then fails.' : ''}
            </Typography>
          </Alert>
        </Snackbar>
        </Portal>
      )}

      <TaskDetailDrawer task={drawerTask} onClose={closeDrawer} showInvitation />

      <Dialog open={Boolean(confirm)} onClose={() => !confirmBusy && setConfirm(null)} maxWidth="xs" fullWidth>
        <DialogTitle>{confirm?.title}</DialogTitle>
        <DialogContent>
          <DialogContentText>{confirm?.message}</DialogContentText>
          {confirmBusy && (
            <DialogContentText role="status" style={{ fontWeight: 500 }}>
              {confirmBusy}
            </DialogContentText>
          )}
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
          <Button onClick={() => setConfirm(null)} disabled={Boolean(confirmBusy)}>
            Cancel
          </Button>
          <Button
            onClick={runConfirm}
            disabled={Boolean(confirmBusy) || (confirm?.dataLoss && !ackChecked)}
            data-destructive
          >
            {confirm?.confirmLabel ?? (confirm?.dataLoss ? 'Delete' : 'Confirm')}
          </Button>
        </DialogActions>
      </Dialog>
    </Page>
  );
};
