import React, { useState } from 'react';
import {
  Drawer,
  Typography,
  IconButton,
  Divider,
  Tooltip,
  makeStyles,
} from '@material-ui/core';
import { X, Copy, Check, Terminal, Plug, Info, Github, Gitlab, ExternalLink, LayoutGrid, BookOpen, GitBranch, Activity, Loader, CircleX } from 'lucide-react';
import { parseEntityRef } from '@backstage/catalog-model';
import { ProvisioningTask } from '../../api/types';
import { taskTypeLabel } from '../../api/transformers';
import { currentStep, formatDuration, timeline } from '../../api/activity';
import { agentWorkspace, cloneInfo, vscodeOpenFolderHref } from '../../api/cloneInfo';

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
  stepRow: {
    display: 'grid',
    gridTemplateColumns: '18px 64px 1fr auto',
    alignItems: 'center',
    gap: 8,
    padding: theme.spacing(0.5, 0),
    fontSize: '0.8125rem',
  },
  stepTime: { color: theme.palette.text.secondary, fontFamily: 'monospace', fontSize: '0.75rem' },
  stepHint: { color: theme.palette.text.secondary, fontSize: '0.75rem', margin: theme.spacing(0.25, 0, 0.75, 4.5) },
  bar: { height: 4, borderRadius: 2, background: theme.palette.divider, margin: theme.spacing(0.5, 0, 1, 4.5), overflow: 'hidden' },
  barFill: { height: '100%', background: theme.palette.primary.main },
}));

/**
 * Every step the agent reported, with when it started and how long it took; the running one is
 * marked, with its typical duration and live output, so a long setup never looks stuck.
 */
function ActivitySection({ task }: { task: ProvisioningTask }) {
  const classes = useStyles();
  const steps = timeline(task);
  const now = currentStep(task);
  const output = typeof task.metadata?.output === 'string' ? (task.metadata.output as string) : undefined;
  if (!steps.length && !now) return null;
  const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  return (
    <>
      <div className={classes.sectionLabel}>
        <Activity size={12} strokeWidth={2} /> Activity
      </div>
      {task.status === 'pending' && now && (
        <div className={classes.stepRow}>
          <Loader size={14} strokeWidth={2} />
          <span className={classes.stepTime}>{time(task.createdAt)}</span>
          <span>{now.label}</span>
          <span className={classes.stepTime}>{formatDuration(now.sinceMs)}</span>
        </div>
      )}
      {steps.map((st, i) => {
        let icon = <Check size={14} strokeWidth={2} color="#079669" />;
        if (st.running) icon = <Loader size={14} strokeWidth={2} />;
        else if (st.label === 'Failed') icon = <CircleX size={14} strokeWidth={2} color="#e5484d" />;
        return (
          <React.Fragment key={`${st.at}-${i}`}>
            <div className={classes.stepRow}>
              {icon}
              <span className={classes.stepTime}>{time(st.at)}</span>
              <span style={st.running ? { fontWeight: 600 } : undefined}>{st.label}</span>
              <span className={classes.stepTime}>{st.durationMs ? formatDuration(st.durationMs) : ''}</span>
            </div>
            {st.running && now?.hint && <div className={classes.stepHint}>{now.hint}</div>}
            {st.running && now?.percent !== undefined && (
              <div className={classes.bar} aria-label={`${now.percent}%`}>
                <div className={classes.barFill} style={{ width: `${now.percent}%` }} />
              </div>
            )}
          </React.Fragment>
        );
      })}
      {output && (task.status === 'in-progress' || task.status === 'pending') && (
        <div className={classes.logsBox} style={{ maxHeight: 200, marginTop: 8 }}>
          {output}
        </div>
      )}
    </>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const classes = useStyles();
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  // Only genuine http(s) URLs are browsable — a raw host:port or a non-HTTP connection
  // string (postgresql://, redis://, a bare Kafka broker address) does nothing useful if
  // opened in a browser, so the link-out affordance is added, not swapped in, and only when
  // it would actually work.
  const isHttpUrl = /^https?:\/\//i.test(value);
  return (
    <div className={classes.connRow}>
      <span className={classes.connValue} title={value}>
        {label ? `${label}: ` : ''}
        {value}
      </span>
      {isHttpUrl && (
        <Tooltip title="Open">
          <IconButton
            size="small"
            aria-label="open"
            component="a"
            href={value}
            target="_blank"
            rel="noopener noreferrer"
          >
            <ExternalLink size={14} strokeWidth={1.5} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title={copied ? 'Copied' : 'Copy'}>
        <IconButton size="small" onClick={copy} aria-label="copy">
          {copied ? <Check size={14} strokeWidth={2} color="#079669" /> : <Copy size={14} strokeWidth={1.5} />}
        </IconButton>
      </Tooltip>
    </div>
  );
}

function LinkRow({ value }: { value: string }) {
  const classes = useStyles();
  return (
    <a
      href={value}
      target="_blank"
      rel="noopener noreferrer"
      className={classes.connRow}
      style={{ textDecoration: 'none', color: 'inherit' }}
    >
      <span className={classes.connValue} title={value}>
        {value}
      </span>
      <ExternalLink size={14} strokeWidth={1.5} />
    </a>
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
  // Set by the scaffolder template that provisioned this resource (see e.g.
  // kafka-training-local's queue-task step, which forwards its publish:github step's
  // remoteUrl) — not every resource has one, only types provisioned via a template that
  // creates a companion GitHub repo. devops/devsecops-capstone-training forward whichever
  // of githubRepoUrl/gitlabRepoUrl actually ran (gated by the trainee's ciTool choice).
  const githubRepoUrl = (task.config as any)?.githubRepoUrl as string | undefined;
  const gitlabRepoUrl = (task.config as any)?.gitlabRepoUrl as string | undefined;
  const clone = cloneInfo(githubRepoUrl || gitlabRepoUrl);
  // Set by agents with auto-clone: where the trainee's repo was cloned on their machine.
  const workspace = agentWorkspace(task.metadata);

  const catalogHref = task.catalogEntityRef ? (() => {
    try {
      const { kind, namespace, name } = parseEntityRef(task.catalogEntityRef!);
      return `/catalog/${namespace ?? 'default'}/${kind.toLowerCase()}/${name}`;
    } catch {
      return undefined;
    }
  })() : undefined;

  // Set from `localProvisioner.resourceDocsUrls` config (resource type -> engineering-docs
  // source id) — a direct link to related documentation (e.g. training materials), when
  // configured. Already a full relative URL (built server-side), no parsing needed here.
  const docsHref = task.docsUrl;

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
          <span>{task.status}</span>
        </div>
        <div className={classes.kv}>
          <span className={classes.kvKey}>Type</span>
          <span>{taskTypeLabel(task)}</span>
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

        <ActivitySection task={task} />

        {conn && (conn.connectionString || conn.ui || (conn.ports && Object.keys(conn.ports).length > 0)) && (
          <>
            <div className={classes.sectionLabel}>
              <Plug size={12} strokeWidth={2} /> How to connect
            </div>
            {conn.connectionString && <CopyRow label="" value={conn.connectionString} />}
            {conn.ui && <CopyRow label="UI" value={conn.ui} />}
            {conn.ports &&
              // Skip whichever port conn.ui already covers (e.g. capstone's frontendPort) —
              // otherwise it's shown twice, once as the "UI" link and once again here as a
              // plain, non-clickable duplicate of the exact same port.
              Object.entries(conn.ports)
                .filter(([, port]) => !conn.ui || !conn.ui.endsWith(`:${port}`))
                .map(([svc, port]) => (
                  <CopyRow key={svc} label={svc} value={`${conn.host ?? 'localhost'}:${port}`} />
                ))}
          </>
        )}

        {githubRepoUrl && (
          <>
            <div className={classes.sectionLabel}>
              <Github size={12} strokeWidth={2} /> GitHub repo
            </div>
            <LinkRow value={githubRepoUrl} />
          </>
        )}

        {gitlabRepoUrl && (
          <>
            <div className={classes.sectionLabel}>
              <Gitlab size={12} strokeWidth={2} /> GitLab repo
            </div>
            <LinkRow value={gitlabRepoUrl} />
          </>
        )}

        {workspace?.path && (workspace.status === 'cloned' || workspace.status === 'existing') && (
          <>
            <div className={classes.sectionLabel}>
              <GitBranch size={12} strokeWidth={2} /> Your code
            </div>
            <CopyRow label="" value={workspace.path} />
            <a
              href={vscodeOpenFolderHref(workspace.path)}
              className={classes.connRow}
              style={{ textDecoration: 'none', color: 'inherit', fontFamily: 'inherit' }}
            >
              <span className={classes.connValue}>Open in VS Code</span>
              <ExternalLink size={14} strokeWidth={1.5} />
            </a>
          </>
        )}

        {clone && !(workspace?.path && (workspace.status === 'cloned' || workspace.status === 'existing')) && (
          <>
            <div className={classes.sectionLabel}>
              <GitBranch size={12} strokeWidth={2} /> Get the code on your laptop
            </div>
            {workspace?.status === 'failed' && workspace.hint && (
              <Typography variant="body2" style={{ color: '#d97706', marginBottom: 8 }}>
                Automatic clone didn't work: {workspace.hint}
              </Typography>
            )}
            <a
              href={clone.vscodeHref}
              className={classes.connRow}
              style={{ textDecoration: 'none', color: 'inherit', fontFamily: 'inherit' }}
            >
              <span className={classes.connValue}>Clone in VS Code</span>
              <ExternalLink size={14} strokeWidth={1.5} />
            </a>
            <CopyRow label="" value={clone.command} />
          </>
        )}

        {catalogHref && (
          <>
            <div className={classes.sectionLabel}>
              <LayoutGrid size={12} strokeWidth={2} /> Catalog
            </div>
            <LinkRow value={catalogHref} />
          </>
        )}

        {docsHref && (
          <>
            <div className={classes.sectionLabel}>
              <BookOpen size={12} strokeWidth={2} /> Training materials
            </div>
            <LinkRow value={docsHref} />
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
