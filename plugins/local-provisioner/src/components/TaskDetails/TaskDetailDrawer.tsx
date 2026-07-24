import React, { useState } from 'react';
import {
  Drawer,
  Typography,
  IconButton,
  Divider,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import { X, Copy, Check, Terminal, Plug, Info } from 'lucide-react';
import { ProvisioningTask } from '../../api/types';

const useStyles = makeStyles(theme => ({
  drawer: { width: 480, maxWidth: '100vw' },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: theme.spacing(2, 2.5),
  },
  body: { padding: theme.spacing(0, 2.5, 3) },
  sectionLabel: {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    margin: theme.spacing(2.5, 0, 1),
  },
  kv: { display: 'flex', justifyContent: 'space-between', padding: theme.spacing(0.5, 0), fontSize: '0.8125rem' },
  kvKey: { color: theme.palette.text.secondary },
  connRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: theme.palette.action.hover,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: theme.spacing(1, 1.25),
    fontFamily: 'monospace',
    fontSize: '0.8125rem',
    marginBottom: theme.spacing(1),
  },
  connValue: { flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  logsBox: {
    background: '#0a0a0a',
    color: '#ededed',
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    lineHeight: 1.6,
    borderRadius: 6,
    padding: theme.spacing(1.5),
    maxHeight: 320,
    overflow: 'auto',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
  },
  error: { color: '#e5484d' },
}));

function CopyRow({ label, value }: { label: string; value: string }) {
  const classes = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <div className={classes.connRow}>
      <span className={classes.connValue} title={value}>
        {label ? `${label}: ` : ''}
        {value}
      </span>
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton size="small" onClick={copy} aria-label="copy">
          {copied ? <Check size={14} strokeWidth={2} color="#079669" /> : <Copy size={14} strokeWidth={1.5} />}
        </IconButton>
      </Tooltip>
    </div>
  );
}

interface Props {
  task: ProvisioningTask | null;
  onClose: () => void;
}

export const TaskDetailDrawer = ({ task, onClose }: Props) => {
  const classes = useStyles();
  if (!task) return null;

  const conn = task.connectionDetails;
  const phase = (task.metadata as any)?.phase as string | undefined;

  return (
    <Drawer anchor="right" open={Boolean(task)} onClose={onClose} classes={{ paper: classes.drawer }}>
      <div className={classes.header}>
        <Typography variant="h6">{task.resourceName}</Typography>
        <IconButton size="small" onClick={onClose} aria-label="close">
          <X size={18} strokeWidth={1.5} />
        </IconButton>
      </div>
      <Divider />
      <div className={classes.body}>
        <div className={classes.sectionLabel}>
          <Info size={12} strokeWidth={2} /> Overview
        </div>
        <div className={classes.kv}>
          <span className={classes.kvKey}>Status</span>
          <span>{task.status}{phase ? ` · ${phase}` : ''}</span>
        </div>
        <div className={classes.kv}>
          <span className={classes.kvKey}>Type</span>
          <span>{task.taskType}</span>
        </div>
        <div className={classes.kv}>
          <span className={classes.kvKey}>Agent</span>
          <span>{task.agentId}</span>
        </div>
        <div className={classes.kv}>
          <span className={classes.kvKey}>Created</span>
          <span>{new Date(task.createdAt).toLocaleString()}</span>
        </div>
        {task.completedAt && (
          <div className={classes.kv}>
            <span className={classes.kvKey}>Completed</span>
            <span>{new Date(task.completedAt).toLocaleString()}</span>
          </div>
        )}

        {conn && (conn.connectionString || conn.ui || (conn.ports && Object.keys(conn.ports).length > 0)) && (
          <>
            <div className={classes.sectionLabel}>
              <Plug size={12} strokeWidth={2} /> How to connect
            </div>
            {conn.connectionString && <CopyRow label="" value={conn.connectionString} />}
            {conn.ui && <CopyRow label="UI" value={conn.ui} />}
            {conn.ports &&
              Object.entries(conn.ports).map(([svc, port]) => (
                <CopyRow key={svc} label={svc} value={`${conn.host ?? 'localhost'}:${port}`} />
              ))}
          </>
        )}

        {task.errorMessage && (
          <>
            <div className={classes.sectionLabel}>Error</div>
            <div className={`${classes.logsBox} ${classes.error}`}>{task.errorMessage}</div>
          </>
        )}

        {task.logs && (
          <>
            <div className={classes.sectionLabel}>
              <Terminal size={12} strokeWidth={2} /> Logs
            </div>
            <div className={classes.logsBox}>{task.logs}</div>
          </>
        )}
      </div>
    </Drawer>
  );
};
