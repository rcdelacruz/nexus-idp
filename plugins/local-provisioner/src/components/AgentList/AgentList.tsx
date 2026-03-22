import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  Typography,
  Box,
  Chip,
  makeStyles,
  CircularProgress,
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  Divider,
  Avatar,
  IconButton,
  Menu,
  MenuItem,
  ListItemIcon,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  Button,
} from '@material-ui/core';
import { AgentRegistration } from '../../api/types';
import CheckCircleIcon from '@material-ui/icons/CheckCircle';
import OfflineBoltIcon from '@material-ui/icons/OfflineBolt';
import ComputerIcon from '@material-ui/icons/Computer';
import FilterListIcon from '@material-ui/icons/FilterList';
import MoreVertIcon from '@material-ui/icons/MoreVert';
import StopIcon from '@material-ui/icons/Stop';
import DeleteIcon from '@material-ui/icons/Delete';
import PlayArrowIcon from '@material-ui/icons/PlayArrow';
import InfoIcon from '@material-ui/icons/Info';

/**
 * Format a date as "X time ago" (e.g., "5 minutes ago", "2 hours ago")
 */
function formatTimeAgo(dateString: string): string {
  try {
    const date = new Date(dateString);
    const now = new Date();
    const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (seconds < 60) {
      return 'Just now';
    }

    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) {
      return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    }

    const hours = Math.floor(minutes / 60);
    if (hours < 24) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
    }

    const days = Math.floor(hours / 24);
    if (days < 7) {
      return `${days} ${days === 1 ? 'day' : 'days'} ago`;
    }

    const weeks = Math.floor(days / 7);
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`;
  } catch {
    return 'Unknown';
  }
}

const useStyles = makeStyles(theme => ({
  card: {
    height: '100%',
  },
  listItem: {
    cursor: 'pointer',
    borderRadius: theme.spacing(1),
    marginBottom: theme.spacing(1),
    transition: 'background-color 0.2s',
    '&:hover': {
      backgroundColor: theme.palette.action.hover,
    },
  },
  selectedItem: {
    backgroundColor: theme.palette.action.selected,
    '&:hover': {
      backgroundColor: theme.palette.action.selected,
    },
  },
  statusChip: {
    fontWeight: 600,
    marginLeft: theme.spacing(1),
  },
  agentAvatar: {
    backgroundColor: theme.palette.primary.main,
  },
  agentInfo: {
    display: 'flex',
    flexDirection: 'column',
  },
  hostname: {
    fontWeight: 600,
    color: theme.palette.text.primary,
  },
  platformInfo: {
    color: theme.palette.text.secondary,
    fontSize: '0.875rem',
  },
  lastSeen: {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
    marginTop: theme.spacing(0.5),
  },
  taskCount: {
    color: theme.palette.text.secondary,
    fontSize: '0.75rem',
  },
  noAgent: {
    textAlign: 'center',
    padding: theme.spacing(3),
    color: theme.palette.text.secondary,
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
  },
}));

interface AgentListProps {
  agents: AgentRegistration[];
  loading: boolean;
  selectedAgentId?: string | null;
  onAgentSelect?: (agentId: string | null) => void;
  taskCounts?: Record<string, number>;
  onDisconnect?: (agentId: string) => Promise<void>;
  onRevoke?: (agentId: string) => Promise<void>;
}

export const AgentList = ({
  agents,
  loading,
  selectedAgentId,
  onAgentSelect,
  taskCounts = {},
  onDisconnect,
  onRevoke,
}: AgentListProps) => {
  const classes = useStyles();
  const [menuAnchor, setMenuAnchor] = useState<{ element: HTMLElement; agentId: string } | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [startInstructionsOpen, setStartInstructionsOpen] = useState(false);
  const [selectedAgentForAction, setSelectedAgentForAction] = useState<AgentRegistration | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const getStatusColor = (isConnected: boolean): 'default' | 'primary' => {
    return isConnected ? 'primary' : 'default';
  };

  const getStatusIcon = (isConnected: boolean) => {
    return isConnected ? (
      <CheckCircleIcon fontSize="small" />
    ) : (
      <OfflineBoltIcon fontSize="small" />
    );
  };

  const getStatusLabel = (isConnected: boolean): string => {
    return isConnected ? 'Online' : 'Offline';
  };

  const formatLastSeen = (dateString: string): string => {
    const timeAgo = formatTimeAgo(dateString);
    return `Last seen: ${timeAgo}`;
  };

  const getDisplayName = (agent: AgentRegistration): string => {
    // Prefer hostname, fallback to machine name, then agent ID
    return agent.hostname || agent.machineName || agent.id.substring(0, 16) + '...';
  };

  const getPlatformDisplay = (agent: AgentRegistration): string => {
    if (agent.platformVersion) {
      return agent.platformVersion;
    }
    if (agent.osPlatform) {
      const platformMap: Record<string, string> = {
        darwin: 'macOS',
        linux: 'Linux',
        win32: 'Windows',
      };
      return platformMap[agent.osPlatform] || agent.osPlatform;
    }
    return 'Unknown platform';
  };

  const handleAgentClick = (agentId: string) => {
    if (onAgentSelect) {
      // Toggle selection: if clicking the selected agent, deselect it
      onAgentSelect(selectedAgentId === agentId ? null : agentId);
    }
  };

  const handleShowAll = () => {
    if (onAgentSelect) {
      onAgentSelect(null);
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>, agent: AgentRegistration) => {
    event.stopPropagation();
    setMenuAnchor({ element: event.currentTarget, agentId: agent.id });
    setSelectedAgentForAction(agent);
  };

  const handleMenuClose = () => {
    setMenuAnchor(null);
  };

  const handleDisconnectClick = () => {
    handleMenuClose();
    setDisconnectDialogOpen(true);
  };

  const handleRevokeClick = () => {
    handleMenuClose();
    setRevokeDialogOpen(true);
  };

  const handleStartInstructionsClick = () => {
    handleMenuClose();
    setStartInstructionsOpen(true);
  };

  const handleDisconnect = async () => {
    if (!selectedAgentForAction || !onDisconnect) return;
    setActionLoading(true);
    try {
      await onDisconnect(selectedAgentForAction.id);
      setDisconnectDialogOpen(false);
      setSelectedAgentForAction(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!selectedAgentForAction || !onRevoke) return;
    setActionLoading(true);
    try {
      await onRevoke(selectedAgentForAction.id);
      setRevokeDialogOpen(false);
      setSelectedAgentForAction(null);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className={classes.card}>
        <CardHeader title="My Agents" />
        <CardContent>
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (agents.length === 0) {
    return (
      <Card className={classes.card}>
        <CardHeader title="My Agents" />
        <CardContent>
          <div className={classes.noAgent}>
            <ComputerIcon style={{ fontSize: 48, marginBottom: 16 }} />
            <Typography variant="h6" gutterBottom>
              No Agents Registered
            </Typography>
            <Typography variant="body2">
              Install and configure the Backstage agent on your local machine to get started.
            </Typography>
            <Box mt={2}>
              <Typography variant="body2" color="primary">
                <a href="/docs/default/component/backstage-agent">
                  View Setup Guide
                </a>
              </Typography>
            </Box>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={classes.card}>
      <CardHeader
        title={`My Agents (${agents.length})`}
        action={
          <div className={classes.headerActions}>
            {selectedAgentId && (
              <Chip
                label="Filtered"
                icon={<FilterListIcon />}
                size="small"
                onDelete={handleShowAll}
                color="primary"
              />
            )}
          </div>
        }
      />
      <CardContent>
        <List>
          {agents.map((agent, index) => {
            const isSelected = selectedAgentId === agent.id;
            const taskCount = taskCounts[agent.id] || 0;

            return (
              <React.Fragment key={agent.id}>
                <ListItem
                  className={`${classes.listItem} ${isSelected ? classes.selectedItem : ''}`}
                  onClick={() => handleAgentClick(agent.id)}
                >
                  <Avatar className={classes.agentAvatar}>
                    <ComputerIcon />
                  </Avatar>
                  <ListItemText
                    primary={
                      <Box display="flex" alignItems="center">
                        <Typography className={classes.hostname}>
                          {getDisplayName(agent)}
                        </Typography>
                        <Chip
                          className={classes.statusChip}
                          label={getStatusLabel(agent.isConnected)}
                          color={getStatusColor(agent.isConnected)}
                          icon={getStatusIcon(agent.isConnected)}
                          size="small"
                        />
                      </Box>
                    }
                    secondary={
                      <div className={classes.agentInfo}>
                        <Typography className={classes.platformInfo}>
                          {getPlatformDisplay(agent)}
                        </Typography>
                        <Typography className={classes.lastSeen}>
                          {formatLastSeen(agent.lastSeenAt)}
                        </Typography>
                        {!agent.isConnected && (
                          <Typography className={classes.taskCount} style={{ color: '#ff9800', marginTop: 4 }}>
                            ⚠️ Agent offline - Click menu to start
                          </Typography>
                        )}
                        {agent.isConnected && taskCount > 0 && (
                          <Typography className={classes.taskCount}>
                            {taskCount} {taskCount === 1 ? 'task' : 'tasks'}
                          </Typography>
                        )}
                      </div>
                    }
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={(e) => handleMenuOpen(e, agent)}
                      size="small"
                    >
                      <MoreVertIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
                {index < agents.length - 1 && <Divider variant="inset" component="li" />}
              </React.Fragment>
            );
          })}
        </List>
      </CardContent>

      {/* Action Menu */}
      <Menu
        anchorEl={menuAnchor?.element}
        open={Boolean(menuAnchor)}
        onClose={handleMenuClose}
      >
        <MenuItem
          onClick={handleStartInstructionsClick}
          disabled={selectedAgentForAction?.isConnected}
        >
          <ListItemIcon>
            <PlayArrowIcon fontSize="small" />
          </ListItemIcon>
          <Typography>Start Agent</Typography>
        </MenuItem>
        <MenuItem
          onClick={handleDisconnectClick}
          disabled={!selectedAgentForAction?.isConnected}
        >
          <ListItemIcon>
            <StopIcon fontSize="small" />
          </ListItemIcon>
          <Typography>Stop Agent</Typography>
        </MenuItem>
        <Divider />
        <MenuItem onClick={handleRevokeClick}>
          <ListItemIcon>
            <DeleteIcon fontSize="small" />
          </ListItemIcon>
          <Typography>Logout & Revoke</Typography>
        </MenuItem>
      </Menu>

      {/* Disconnect Confirmation Dialog */}
      <Dialog
        open={disconnectDialogOpen}
        onClose={() => !actionLoading && setDisconnectDialogOpen(false)}
      >
        <DialogTitle>Stop Agent?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will stop the agent running on <strong>{selectedAgentForAction?.hostname || selectedAgentForAction?.machineName}</strong>.
          </DialogContentText>
          <Box mt={2} mb={1}>
            <Typography variant="subtitle2" gutterBottom>
              What happens:
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent process will be stopped gracefully (SIGTERM)
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent will appear as "Offline" in the UI
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • No tasks will be assigned to this agent
            </Typography>
          </Box>
          <Box mt={2} mb={1}>
            <Typography variant="subtitle2" gutterBottom>
              To restart the agent later:
            </Typography>
            <Box mt={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <code>backstage-agent start</code>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectDialogOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleDisconnect} color="primary" disabled={actionLoading}>
            {actionLoading ? 'Stopping...' : 'Stop Agent'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <Dialog
        open={revokeDialogOpen}
        onClose={() => !actionLoading && setRevokeDialogOpen(false)}
      >
        <DialogTitle>Logout & Revoke Agent?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete the agent <strong>{selectedAgentForAction?.hostname || selectedAgentForAction?.machineName}</strong> from the system.
          </DialogContentText>
          <Box mt={2} mb={1}>
            <Typography variant="subtitle2" gutterBottom>
              What happens:
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent will be stopped immediately (if running)
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent registration will be deleted from database
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • All pending tasks for this agent will be cancelled
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • This action cannot be undone
            </Typography>
          </Box>
          <Box mt={2} mb={1}>
            <Typography variant="subtitle2" gutterBottom>
              To use this machine again:
            </Typography>
            <Box mt={1} mb={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <code>backstage-agent login</code>
            </Box>
            <Typography variant="caption" color="textSecondary">
              You will need to authenticate with Google OAuth again
            </Typography>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialogOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleRevoke} color="secondary" disabled={actionLoading}>
            {actionLoading ? 'Revoking...' : 'Logout & Revoke'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Start Agent Instructions Dialog */}
      <Dialog
        open={startInstructionsOpen}
        onClose={() => setStartInstructionsOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          <Box display="flex" alignItems="center">
            <PlayArrowIcon style={{ marginRight: 8 }} />
            Start Agent
          </Box>
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            To start the agent on <strong>{selectedAgentForAction?.hostname || selectedAgentForAction?.machineName}</strong>, run the following command:
          </DialogContentText>

          <Box mt={2} mb={2} p={2} bgcolor="grey.100" borderRadius={4}>
            <Typography variant="body2" component="pre" style={{ margin: 0, fontFamily: 'monospace' }}>
              backstage-agent start
            </Typography>
          </Box>

          <Box mt={2} mb={1}>
            <Typography variant="subtitle2" gutterBottom>
              What this does:
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Starts the agent as a background daemon process
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent will appear as "Online" in the UI within 3 seconds
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent will continue running even if you close the terminal
            </Typography>
            <Typography variant="body2" color="textSecondary" gutterBottom>
              • Agent will receive and execute provisioning tasks
            </Typography>
          </Box>

          <Box mt={2} mb={1} p={2} bgcolor="info.light" borderRadius={4}>
            <Box display="flex" alignItems="flex-start">
              <InfoIcon fontSize="small" style={{ marginRight: 8, marginTop: 2 }} color="primary" />
              <Typography variant="body2" color="textPrimary">
                The agent runs in the background. Pressing Ctrl+C after starting will NOT stop the agent.
                Use the "Stop Agent" button in the UI or run <code>backstage-agent stop</code> to stop it.
              </Typography>
            </Box>
          </Box>

          <Box mt={2} mb={1}>
            <Typography variant="subtitle2" gutterBottom>
              Useful commands:
            </Typography>
            <Box mt={1} mb={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <Typography variant="body2" component="pre" style={{ margin: 0, fontFamily: 'monospace' }}>
                backstage-agent status  # Check if agent is running
              </Typography>
            </Box>
            <Box mt={1} mb={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <Typography variant="body2" component="pre" style={{ margin: 0, fontFamily: 'monospace' }}>
                backstage-agent stop    # Stop the agent
              </Typography>
            </Box>
            <Box mt={1} mb={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <Typography variant="body2" component="pre" style={{ margin: 0, fontFamily: 'monospace' }}>
                tail -f ~/.backstage-agent/logs/agent.log  # View logs
              </Typography>
            </Box>
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setStartInstructionsOpen(false)} color="primary">
            Got it
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};
