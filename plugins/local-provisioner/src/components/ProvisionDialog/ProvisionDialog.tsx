import React, { useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  MenuItem,
  Box,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { Database, Layers, Zap, Box as BoxIcon } from 'lucide-react';
import { AgentRegistration, CreateTaskRequest } from '../../api/types';

/** Provisionable resource types. Each maps to a bundled agent template + sensible defaults. */
const RESOURCE_TYPES = [
  { type: 'kafka', taskType: 'provision-kafka', label: 'Kafka', icon: Layers, port: 9092, desc: 'Apache Kafka broker + Zookeeper' },
  { type: 'postgres', taskType: 'provision-postgres', label: 'PostgreSQL', icon: Database, port: 5432, desc: 'PostgreSQL database' },
  { type: 'redis', taskType: 'provision-redis', label: 'Redis', icon: Zap, port: 6379, desc: 'Redis in-memory store' },
  { type: 'mongodb', taskType: 'provision-mongodb', label: 'MongoDB', icon: BoxIcon, port: 27017, desc: 'MongoDB document database' },
] as const;

const useStyles = makeStyles(theme => ({
  typeGrid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: theme.spacing(2) },
  typeCard: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 8,
    padding: theme.spacing(1.5),
    cursor: 'pointer',
    transition: 'border-color 0.15s',
  },
  typeCardSelected: { borderColor: theme.palette.primary.main },
  typeDesc: { fontSize: '0.75rem', color: theme.palette.text.secondary },
  field: { marginBottom: theme.spacing(2) },
  hint: { fontSize: '0.75rem', color: theme.palette.text.secondary, marginTop: theme.spacing(1) },
}));

interface Props {
  open: boolean;
  agents: AgentRegistration[];
  onClose: () => void;
  onProvision: (request: CreateTaskRequest) => Promise<void>;
}

export const ProvisionDialog = ({ open, agents, onClose, onProvision }: Props) => {
  const classes = useStyles();
  const connectedAgents = agents.filter(a => a.isConnected);

  const [typeIdx, setTypeIdx] = useState(0);
  const [resourceName, setResourceName] = useState('');
  const [agentId, setAgentId] = useState('');
  const [port, setPort] = useState<number>(RESOURCE_TYPES[0].port);
  const [submitting, setSubmitting] = useState(false);

  const selected = RESOURCE_TYPES[typeIdx];
  const nameValid = /^[a-z0-9][a-z0-9-]{1,38}$/.test(resourceName);
  const effectiveAgent = agentId || connectedAgents[0]?.id || '';
  const canSubmit = nameValid && Boolean(effectiveAgent) && !submitting;

  const selectType = (idx: number) => {
    setTypeIdx(idx);
    setPort(RESOURCE_TYPES[idx].port);
  };

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await onProvision({
        agent_id: effectiveAgent,
        task_type: selected.taskType,
        resource_name: resourceName,
        config: { resourceName, port, uiPort: selected.type === 'kafka' ? 8080 : undefined },
      });
      setResourceName('');
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Provision a resource</DialogTitle>
      <DialogContent>
        <Typography variant="body2" style={{ marginBottom: 16 }}>
          Runs locally on your selected machine via its agent. Once provisioned, it works offline.
        </Typography>

        <div className={classes.typeGrid}>
          {RESOURCE_TYPES.map((rt, idx) => {
            const Icon = rt.icon;
            return (
              <div
                key={rt.type}
                className={`${classes.typeCard} ${idx === typeIdx ? classes.typeCardSelected : ''}`}
                onClick={() => selectType(idx)}
                onKeyDown={e => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectType(idx);
                  }
                }}
                role="button"
                tabIndex={0}
                aria-pressed={idx === typeIdx}
              >
                <Icon size={20} strokeWidth={1.5} />
                <Box>
                  <div>{rt.label}</div>
                  <div className={classes.typeDesc}>{rt.desc}</div>
                </Box>
              </div>
            );
          })}
        </div>

        <TextField
          className={classes.field}
          label="Resource name"
          fullWidth
          value={resourceName}
          onChange={e => setResourceName(e.target.value.toLowerCase())}
          error={resourceName.length > 0 && !nameValid}
          helperText={
            resourceName.length > 0 && !nameValid
              ? 'Lowercase letters, numbers and hyphens; 2–39 chars.'
              : 'e.g. my-kafka'
          }
        />

        <TextField
          className={classes.field}
          label="Port"
          type="number"
          fullWidth
          value={port}
          onChange={e => setPort(Number(e.target.value))}
        />

        <TextField
          className={classes.field}
          select
          label="Target agent"
          fullWidth
          value={effectiveAgent}
          onChange={e => setAgentId(e.target.value)}
          disabled={connectedAgents.length === 0}
          helperText={
            connectedAgents.length === 0
              ? 'No connected agent. Start one with `backstage-agent start`.'
              : 'The machine the resource is provisioned to.'
          }
        >
          {connectedAgents.map(a => (
            <MenuItem key={a.id} value={a.id}>
              {a.machineName || a.hostname || a.id} ({a.osPlatform})
            </MenuItem>
          ))}
        </TextField>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button color="primary" variant="contained" onClick={submit} disabled={!canSubmit}>
          {submitting ? 'Provisioning…' : 'Provision'}
        </Button>
      </DialogActions>
    </Dialog>
  );
};
