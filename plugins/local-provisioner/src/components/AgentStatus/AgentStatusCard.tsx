import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardHeader,
  CardActions,
  Typography,
  Box,
  Chip,
  makeStyles,
  CircularProgress,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
} from '@material-ui/core';
import { AgentRegistration } from '../../api/types';
import { CheckCircle, ZapOff, Trash2, Square } from 'lucide-react';

const useStyles = makeStyles(theme => ({
  card: {
    height: '100%',
  },
  statusChip: {
    fontWeight: 600,
  },
  infoRow: {
    display: 'flex',
    justifyContent: 'space-between',
    marginBottom: theme.spacing(1),
  },
  label: {
    fontWeight: 600,
    color: theme.palette.text.secondary,
  },
  value: {
    color: theme.palette.text.primary,
  },
  noAgent: {
    textAlign: 'center',
    padding: theme.spacing(3),
    color: theme.palette.text.secondary,
  },
}));

interface AgentStatusCardProps {
  agent: AgentRegistration | null;
  loading: boolean;
  onDisconnect?: (agentId: string) => Promise<void>;
  onRevoke?: (agentId: string) => Promise<void>;
}

export const AgentStatusCard = ({ agent, loading, onDisconnect, onRevoke }: AgentStatusCardProps) => {
  const classes = useStyles();
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [revokeDialogOpen, setRevokeDialogOpen] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const getStatusColor = (isConnected: boolean): 'default' | 'primary' => {
    return isConnected ? 'primary' : 'default';
  };

  const getStatusIcon = (isConnected: boolean) => {
    return isConnected ? (
      <CheckCircle size={16} strokeWidth={1.5} />
    ) : (
      <ZapOff size={16} strokeWidth={1.5} />
    );
  };

  const getStatusLabel = (isConnected: boolean): string => {
    return isConnected ? 'online' : 'offline';
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString();
  };

  const handleDisconnect = async () => {
    if (!agent || !onDisconnect) return;
    setActionLoading(true);
    try {
      await onDisconnect(agent.id);
      setDisconnectDialogOpen(false);
    } finally {
      setActionLoading(false);
    }
  };

  const handleRevoke = async () => {
    if (!agent || !onRevoke) return;
    setActionLoading(true);
    try {
      await onRevoke(agent.id);
      setRevokeDialogOpen(false);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <Card className={classes.card}>
        <CardHeader title="Agent Status" />
        <CardContent>
          <Box display="flex" justifyContent="center" p={3}>
            <CircularProgress />
          </Box>
        </CardContent>
      </Card>
    );
  }

  if (!agent) {
    return (
      <Card className={classes.card}>
        <CardHeader title="Agent Status" />
        <CardContent>
          <div className={classes.noAgent}>
            <ZapOff size={48} strokeWidth={1.5} style={{ marginBottom: 16 }} />
            <Typography variant="h6" gutterBottom>
              No Agent Registered
            </Typography>
            <Typography variant="body2">
              Install and configure the Backstage agent on your local machine to get started.
            </Typography>
            <Box mt={2}>
              <Typography variant="body2" color="primary">
                {/* TODO: wire to local-provisioner engineering-docs source once plugins are in separate repos */}
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
        title="Agent Status"
        action={
          <Chip
            className={classes.statusChip}
            label={getStatusLabel(agent.isConnected)}
            color={getStatusColor(agent.isConnected)}
            icon={getStatusIcon(agent.isConnected)}
            size="small"
          />
        }
      />
      <CardContent>
        <div className={classes.infoRow}>
          <Typography className={classes.label}>Machine Name:</Typography>
          <Typography className={classes.value}>{agent.machineName || 'N/A'}</Typography>
        </div>
        <div className={classes.infoRow}>
          <Typography className={classes.label}>Platform:</Typography>
          <Typography className={classes.value}>{agent.osPlatform || 'N/A'}</Typography>
        </div>
        <div className={classes.infoRow}>
          <Typography className={classes.label}>Version:</Typography>
          <Typography className={classes.value}>{agent.agentVersion || 'N/A'}</Typography>
        </div>
        <div className={classes.infoRow}>
          <Typography className={classes.label}>Last Seen:</Typography>
          <Typography className={classes.value}>
            {formatDate(agent.lastSeenAt)}
          </Typography>
        </div>
        <div className={classes.infoRow}>
          <Typography className={classes.label}>Registered:</Typography>
          <Typography className={classes.value}>
            {formatDate(agent.createdAt)}
          </Typography>
        </div>
      </CardContent>
      <CardActions>
        <Button
          size="small"
          startIcon={<Square size={16} strokeWidth={1.5} />}
          onClick={() => setDisconnectDialogOpen(true)}
          disabled={!agent.isConnected || actionLoading}
        >
          Disconnect
        </Button>
        <Button
          size="small"
          color="secondary"
          startIcon={<Trash2 size={16} strokeWidth={1.5} />}
          onClick={() => setRevokeDialogOpen(true)}
          disabled={actionLoading}
        >
          Revoke
        </Button>
      </CardActions>

      {/* Disconnect Confirmation Dialog */}
      <Dialog
        open={disconnectDialogOpen}
        onClose={() => setDisconnectDialogOpen(false)}
      >
        <DialogTitle>Disconnect Agent?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will stop the agent on your local machine. You can restart it by running:
            <Box mt={1} mb={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <code>backstage-agent start</code>
            </Box>
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisconnectDialogOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleDisconnect} color="primary" disabled={actionLoading}>
            {actionLoading ? 'Disconnecting...' : 'Disconnect'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Revoke Confirmation Dialog */}
      <Dialog
        open={revokeDialogOpen}
        onClose={() => setRevokeDialogOpen(false)}
      >
        <DialogTitle>Revoke Agent?</DialogTitle>
        <DialogContent>
          <DialogContentText>
            This will permanently delete the agent registration from the system.
            The agent will be disconnected and you will need to re-authenticate by running:
            <Box mt={1} mb={1} p={1} bgcolor="grey.100" borderRadius={4}>
              <code>backstage-agent login</code>
            </Box>
            This action cannot be undone.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRevokeDialogOpen(false)} disabled={actionLoading}>
            Cancel
          </Button>
          <Button onClick={handleRevoke} color="secondary" disabled={actionLoading}>
            {actionLoading ? 'Revoking...' : 'Revoke'}
          </Button>
        </DialogActions>
      </Dialog>
    </Card>
  );
};
