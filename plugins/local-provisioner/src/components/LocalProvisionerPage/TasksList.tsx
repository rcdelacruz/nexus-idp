import React, { useState } from 'react';
import {
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Chip,
  Typography,
  Box,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  Checkbox,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import {
  MoreVertical,
  Eye,
  RotateCcw,
  Trash2,
  Send,
  Square,
  Play,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader,
  Clock,
  Inbox,
} from 'lucide-react';
import { ProvisioningTask, Resource, TaskStatus } from '../../api/types';

export type LifecycleAction = 'stop' | 'start' | 'restart' | 'deprovision';

const useStyles = makeStyles(theme => ({
  statusChip: {
    fontWeight: 600,
    border: '1px solid',
    background: 'transparent',
    '& .MuiChip-label': { paddingLeft: 6, paddingRight: 8 },
  },
  // Status colours target the label + icon directly (MUI v4 root color loses the specificity race).
  ok: {
    borderColor: theme.palette.status.ok,
    '& .MuiChip-label': { color: theme.palette.status.ok },
    '& .MuiChip-icon': { color: theme.palette.status.ok },
  },
  running: {
    borderColor: theme.palette.status.running,
    '& .MuiChip-label': { color: theme.palette.status.running },
    '& .MuiChip-icon': { color: theme.palette.status.running },
  },
  error: {
    borderColor: theme.palette.status.error,
    '& .MuiChip-label': { color: theme.palette.status.error },
    '& .MuiChip-icon': { color: theme.palette.status.error },
  },
  pending: {
    borderColor: theme.palette.status.pending,
    '& .MuiChip-label': { color: theme.palette.status.pending },
    '& .MuiChip-icon': { color: theme.palette.status.pending },
  },
  typeCell: { color: theme.palette.text.secondary, fontSize: '0.8125rem' },
  destructive: { color: '#e5484d' },
  rowButton: { padding: 6 },
  emptyState: {
    textAlign: 'center',
    padding: theme.spacing(6, 4),
    color: theme.palette.text.secondary,
  },
  emptyIcon: { color: theme.palette.text.secondary, marginBottom: theme.spacing(1.5) },
  skeletonRow: {
    height: 20,
    borderRadius: 4,
    background: theme.palette.action.hover,
    margin: theme.spacing(1.5, 0),
  },
}));

interface TasksListProps {
  tasks: ProvisioningTask[];
  /** Live resource state, keyed by `${agentId}::${resourceName}` — see `resourceKey()`. */
  resources: Record<string, Resource>;
  loading: boolean;
  error: Error | null;
  onView: (task: ProvisioningTask) => void;
  onDelete: (task: ProvisioningTask) => void;
  onRetry: (task: ProvisioningTask) => void;
  onDispatch: (task: ProvisioningTask) => void;
  onLifecycle: (task: ProvisioningTask, action: LifecycleAction) => void;
  selectedTaskIds: Set<string>;
  onToggleSelect: (taskId: string) => void;
  onToggleSelectAll: () => void;
}

/** Key resources/tasks by (agent, resource name) — the pair a resource is folded on. */
export const resourceKey = (agentId: string, resourceName: string) =>
  `${agentId}::${resourceName}`;

const STATUS_META: Record<
  TaskStatus,
  { cls: keyof ReturnType<typeof useStyles>; icon: React.ReactNode; label: string }
> = {
  completed: { cls: 'ok', icon: <CheckCircle size={13} strokeWidth={2} />, label: 'completed' },
  'in-progress': { cls: 'running', icon: <Loader size={13} strokeWidth={2} />, label: 'in progress' },
  failed: { cls: 'error', icon: <XCircle size={13} strokeWidth={2} />, label: 'failed' },
  pending: { cls: 'pending', icon: <Clock size={13} strokeWidth={2} />, label: 'pending' },
};

export const TasksList = ({
  tasks,
  resources,
  loading,
  error,
  onView,
  onDelete,
  onRetry,
  onDispatch,
  onLifecycle,
  selectedTaskIds,
  onToggleSelect,
  onToggleSelectAll,
}: TasksListProps) => {
  const classes = useStyles();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [menuTask, setMenuTask] = useState<ProvisioningTask | null>(null);

  const openMenu = (e: React.MouseEvent<HTMLElement>, task: ProvisioningTask) => {
    setMenuAnchor(e.currentTarget);
    setMenuTask(task);
  };
  const closeMenu = () => {
    setMenuAnchor(null);
    setMenuTask(null);
  };
  const run = (fn: () => void) => {
    fn();
    closeMenu();
  };

  const formatDate = (dateString?: string) =>
    dateString ? new Date(dateString).toLocaleString() : 'N/A';

  if (loading && tasks.length === 0) {
    return (
      <Box>
        {[0, 1, 2].map(i => (
          <div key={i} className={classes.skeletonRow} style={{ width: `${90 - i * 10}%` }} />
        ))}
      </Box>
    );
  }

  if (error) {
    return <Alert severity="error">Failed to load tasks: {error.message}</Alert>;
  }

  if (tasks.length === 0) {
    return (
      <div className={classes.emptyState}>
        <Inbox size={28} strokeWidth={1.5} className={classes.emptyIcon} />
        <Typography variant="h6" gutterBottom>
          No tasks yet
        </Typography>
        <Typography variant="body2">
          Provision a resource to see it here — it runs locally on your machine via your agent.
        </Typography>
      </div>
    );
  }

  return (
    <>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell padding="checkbox">
                <Checkbox
                  size="small"
                  indeterminate={selectedTaskIds.size > 0 && selectedTaskIds.size < tasks.length}
                  checked={tasks.length > 0 && selectedTaskIds.size === tasks.length}
                  onChange={onToggleSelectAll}
                  inputProps={{ 'aria-label': 'select all tasks' }}
                />
              </TableCell>
              <TableCell>Resource</TableCell>
              <TableCell>Type</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Created</TableCell>
              <TableCell align="right" />
            </TableRow>
          </TableHead>
          <TableBody>
            {tasks.map(task => {
              const meta = STATUS_META[task.status];
              return (
                <TableRow key={task.id} hover style={{ cursor: 'pointer' }}>
                  <TableCell padding="checkbox" onClick={e => e.stopPropagation()}>
                    <Checkbox
                      size="small"
                      checked={selectedTaskIds.has(task.id)}
                      onChange={() => onToggleSelect(task.id)}
                      inputProps={{ 'aria-label': `select task ${task.resourceName}` }}
                    />
                  </TableCell>
                  <TableCell onClick={() => onView(task)}>{task.resourceName}</TableCell>
                  <TableCell className={classes.typeCell} onClick={() => onView(task)}>
                    {task.taskType}
                  </TableCell>
                  <TableCell onClick={() => onView(task)}>
                    <Chip
                      className={`${classes.statusChip} ${classes[meta.cls]}`}
                      icon={meta.icon as React.ReactElement}
                      label={meta.label}
                      size="small"
                    />
                  </TableCell>
                  <TableCell className={classes.typeCell} onClick={() => onView(task)}>
                    {formatDate(task.createdAt)}
                  </TableCell>
                  <TableCell align="right">
                    <IconButton
                      className={classes.rowButton}
                      size="small"
                      aria-label="actions"
                      onClick={e => openMenu(e, task)}
                    >
                      <MoreVertical size={16} strokeWidth={1.5} />
                    </IconButton>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>

      <Menu anchorEl={menuAnchor} open={Boolean(menuAnchor)} onClose={closeMenu}>
        {menuTask && (() => {
          const resource = resources[resourceKey(menuTask.agentId, menuTask.resourceName)];
          // Only the row that IS the resource's current/latest task carries lifecycle controls —
          // otherwise an old superseded provision row would keep showing Stop/Start forever,
          // disconnected from what actually happened since (the bug this replaces).
          const state =
            resource && resource.latestTaskId === menuTask.id ? resource.state : undefined;
          return [
          <MenuItem key="view" onClick={() => run(() => onView(menuTask))}>
            <ListItemIcon style={{ minWidth: 32 }}>
              <Eye size={16} strokeWidth={1.5} />
            </ListItemIcon>
            View details
          </MenuItem>,
          // Stuck-task recovery for anything still pending/in-progress
          (menuTask.status === 'pending' || menuTask.status === 'in-progress') && (
            <MenuItem key="dispatch" onClick={() => run(() => onDispatch(menuTask))}>
              <ListItemIcon style={{ minWidth: 32 }}>
                <Send size={16} strokeWidth={1.5} />
              </ListItemIcon>
              Re-send to agent
            </MenuItem>
          ),
          menuTask.status === 'failed' && (
            <MenuItem key="retry" onClick={() => run(() => onRetry(menuTask))}>
              <ListItemIcon style={{ minWidth: 32 }}>
                <RotateCcw size={16} strokeWidth={1.5} />
              </ListItemIcon>
              Retry
            </MenuItem>
          ),
          // Lifecycle controls reflect the resource's LIVE state, not this row's own status —
          // only the action(s) valid from the current state are offered.
          state === 'running' && (
            <MenuItem key="stop" onClick={() => run(() => onLifecycle(menuTask, 'stop'))}>
              <ListItemIcon style={{ minWidth: 32 }}>
                <Square size={16} strokeWidth={1.5} />
              </ListItemIcon>
              Stop
            </MenuItem>
          ),
          state === 'stopped' && (
            <MenuItem key="start" onClick={() => run(() => onLifecycle(menuTask, 'start'))}>
              <ListItemIcon style={{ minWidth: 32 }}>
                <Play size={16} strokeWidth={1.5} />
              </ListItemIcon>
              Start
            </MenuItem>
          ),
          (state === 'running' || state === 'stopped') && (
            <MenuItem key="restart" onClick={() => run(() => onLifecycle(menuTask, 'restart'))}>
              <ListItemIcon style={{ minWidth: 32 }}>
                <RefreshCw size={16} strokeWidth={1.5} />
              </ListItemIcon>
              Restart
            </MenuItem>
          ),
          (state === 'running' || state === 'stopped' || state === 'error') && (
            <MenuItem
              key="teardown"
              className={classes.destructive}
              onClick={() => run(() => onLifecycle(menuTask, 'deprovision'))}
            >
              <ListItemIcon style={{ minWidth: 32 }}>
                <Trash2 size={16} strokeWidth={1.5} color="#e5484d" />
              </ListItemIcon>
              Stop &amp; remove (deletes data)
            </MenuItem>
          ),
          <MenuItem
            key="delete"
            className={classes.destructive}
            onClick={() => run(() => onDelete(menuTask))}
          >
            <ListItemIcon style={{ minWidth: 32 }}>
              <Trash2 size={16} strokeWidth={1.5} color="#e5484d" />
            </ListItemIcon>
            Delete task
          </MenuItem>,
          ].filter(Boolean);
        })()}
      </Menu>
    </>
  );
};
