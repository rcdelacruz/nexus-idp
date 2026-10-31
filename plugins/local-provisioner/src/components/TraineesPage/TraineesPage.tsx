import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Content, Header, Page, InfoCard } from '@backstage/core-components';
import {
  Box,
  Button,
  Checkbox,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
  makeStyles,
} from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useApi, alertApiRef } from '@backstage/core-plugin-api';
import { Link as RouterLink } from 'react-router-dom';
import { parseEntityRef } from '@backstage/catalog-model';
import { ChevronDown, ChevronRight, ExternalLink, GraduationCap, RefreshCw, Trash2 } from 'lucide-react';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { formatDuration, stepLabel } from '../../api/activity';
import { CapstoneSecrets, TraineeRow } from '../../api/types';

const useStyles = makeStyles(theme => ({
  muted: { color: theme.palette.text.secondary, fontSize: '0.8125rem' },
  mono: { fontFamily: 'monospace', fontSize: '0.75rem' },
  dot: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' },
  pill: {
    display: 'inline-block',
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 100,
    padding: '1px 8px',
    marginRight: 4,
    marginBottom: 4,
    fontSize: '0.75rem',
  },
  strip: { display: 'flex', gap: 3, alignItems: 'flex-end', height: 28 },
  bar: { width: 10, borderRadius: 2, background: theme.palette.primary.main },
  barEmpty: { width: 10, height: 2, borderRadius: 2, background: theme.palette.divider },
  detail: { padding: theme.spacing(2, 2, 2.5, 6), background: theme.palette.action.hover },
  sectionLabel: {
    fontSize: '0.6875rem',
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: theme.palette.text.secondary,
    margin: theme.spacing(1.5, 0, 0.75),
  },
  emptyState: { textAlign: 'center', padding: theme.spacing(6, 4), color: theme.palette.text.secondary },
  pre: {
    fontFamily: 'monospace',
    fontSize: '0.75rem',
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    background: theme.palette.action.hover,
    border: `1px solid ${theme.palette.divider}`,
    borderRadius: 6,
    padding: theme.spacing(1, 1.25),
    margin: theme.spacing(0.5, 0, 1.5),
    maxHeight: 260,
    overflow: 'auto',
  },
}));

/** One-line summary of a check's output: the seeded-resources check prints {checked, missing}. */
export function checkSummary(c: { status: string; exitCode?: number; output?: string }): string {
  // Backend task status values: pending, in-progress, completed, failed.
  if (c.status === 'pending' || c.status === 'in-progress') return 'running…';
  const json = (c.output ?? '').split('\n').map(l => l.trim()).reverse().find(l => l.startsWith('{'));
  try {
    const r = json ? JSON.parse(json) : undefined;
    if (r && typeof r.checked === 'number' && Array.isArray(r.missing)) {
      return r.missing.length ? `${r.missing.length} of ${r.checked} missing or replaced: ${r.missing.join(', ')}` : `all ${r.checked} intact`;
    }
    // Capstone grader JSON: {phase, items: [{points, got}], hard_fails: [], auto_total}
    if (r && Array.isArray(r.items) && typeof r.auto_total === 'number') {
      const max = r.items.reduce((sum: number, i: any) => sum + (Number(i.points) || 0), 0);
      const hard = Array.isArray(r.hard_fails) ? r.hard_fails : [];
      return `${r.auto_total}/${max} automated points (${r.phase ?? 'pre'})${hard.length ? ` · ${hard.length} HARD FAIL: ${hard.join('; ')}` : ' · no hard fails'}`;
    }
  } catch {
    // fall through to the exit code
  }
  if (c.exitCode === 0) return 'passed';
  if (c.exitCode === undefined || c.exitCode === null) {
    // Failed before the check ran (no exit code): the agent's reason is the useful part.
    const reason = (c.output ?? '').trim().split('\n').pop()?.trim();
    return reason ? `did not run: ${reason.slice(0, 200)}` : 'did not run';
  }
  return `failed (exit ${c.exitCode})`;
}

/** Capstone actions for instructors: the Day-4 handout PR and the instructor-only seed data. */
function CapstonePanel({ row, onChanged }: { row: TraineeRow; onChanged: () => void }) {
  const classes = useStyles();
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const c = row.capstone!;
  const [confirmHandout, setConfirmHandout] = useState(false);
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<CapstoneSecrets | null>(null);

  const sendHandout = async () => {
    setBusy(true);
    try {
      const r = await api.openCapstoneHandout(c.id);
      alertApi.post({ message: r.created ? 'Day-4 handout PR opened' : 'Handout PR was already open', severity: 'success', display: 'transient' });
      onChanged();
    } catch (e: any) {
      alertApi.post({ message: `Handout failed: ${e.message}`, severity: 'error' });
    } finally {
      setBusy(false);
      setConfirmHandout(false);
    }
  };
  const runCheck = async (name: string) => {
    setBusy(true);
    try {
      await api.runCapstoneCheck(c.id, name);
      alertApi.post({ message: 'Check sent to the trainee\'s agent — the result appears here when it reports', severity: 'info', display: 'transient' });
      onChanged();
    } catch (e: any) {
      alertApi.post({ message: `Check not started: ${e.message}`, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };
  const reveal = async () => {
    try {
      setSecrets(await api.getCapstoneSecrets(c.id));
    } catch (e: any) {
      alertApi.post({ message: e.message, severity: 'error' });
    }
  };

  return (
    <>
      <div className={classes.sectionLabel}>Capstone</div>
      <Typography variant="body2">
        {c.capstone} · trainee #{c.traineeNo} · {c.status}
      </Typography>
      {(c.awaitingSeedReport || c.seedReportedAt) && (
        <Typography className={classes.muted}>
          Seed:{' '}
          {c.awaitingSeedReport
            ? 'waiting for the trainee\'s lab to seed and report'
            : `reported by the trainee's laptop ${relativeTime(c.seedReportedAt)} (unverified)`}
        </Typography>
      )}
      <Typography className={classes.muted}>
        Day-4 handout:{' '}
        {c.handoutPrUrl ? (
          <a href={c.handoutPrUrl} target="_blank" rel="noopener noreferrer">
            PR opened {relativeTime(c.handoutAt)}
          </a>
        ) : (
          'not sent'
        )}
      </Typography>
      <Box mt={1} display="flex" style={{ gap: 8 }}>
        <Button size="small" variant="outlined" disabled={!row.repoUrl || busy} onClick={() => setConfirmHandout(true)}>
          {c.handoutPrUrl ? 'Re-send Day-4 handout' : 'Send Day-4 handout'}
        </Button>
        <Button size="small" variant="outlined" disabled={c.awaitingSeedReport} onClick={reveal}>
          Instructor data
        </Button>
      </Box>

      {(c.availableChecks ?? []).length > 0 && (
        <>
          <div className={classes.sectionLabel}>Lab checks</div>
          {(c.availableChecks ?? []).map(chk => {
            const last = (row.checks ?? []).find(r => r.name === chk.name);
            return (
              <Box key={chk.name} display="flex" alignItems="center" style={{ gap: 8, marginBottom: 4 }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={busy || row.environment.state !== 'running' || c.awaitingSeedReport}
                  onClick={() => runCheck(chk.name)}
                >
                  Run
                </Button>
                <Typography variant="body2">{chk.title}</Typography>
                {last && (
                  <Typography className={classes.muted}>
                    · {checkSummary(last)} · {relativeTime(last.at)}
                  </Typography>
                )}
              </Box>
            );
          })}
        </>
      )}

      <Dialog open={confirmHandout} onClose={() => setConfirmHandout(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Send the Day-4 handout?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Opens the sabotaged pull request on {row.traineeEmail}'s repository, as the instructor guide describes. Don't tell
            the trainee it's a test. Running it again reuses the same branch and PR.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmHandout(false)}>Cancel</Button>
          <Button color="primary" disabled={busy} onClick={sendHandout}>
            Open PR
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(secrets)} onClose={() => setSecrets(null)} maxWidth="md" fullWidth>
        <DialogTitle>Instructor data: {row.traineeEmail} (#{c.traineeNo})</DialogTitle>
        <DialogContent>
          <Typography className={classes.muted}>
            Instructor-only. Never paste this into chat or a ticket the trainee (or an AI agent) can read. Viewing it is logged.
          </Typography>
          <div className={classes.sectionLabel}>Seeded credentials</div>
          <pre className={classes.pre}>{secrets?.credentials}</pre>
          <div className={classes.sectionLabel}>Handover answer key</div>
          <pre className={classes.pre}>{secrets?.answerKey}</pre>
          <div className={classes.sectionLabel}>Grading</div>
          <Typography variant="body2">
            Save the manifest below as <code>manifest.json</code> and the credentials as <code>credentials.txt</code>, clone the
            trainee repo, then run from the capstone repo:
          </Typography>
          <pre className={classes.pre}>{secrets?.gradeCommand}</pre>
          <div className={classes.sectionLabel}>Seed manifest</div>
          <pre className={classes.pre}>{secrets ? JSON.stringify(secrets.seedManifest, null, 2) : ''}</pre>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSecrets(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** owner/repo of a github.com URL (display only — the server re-checks everything). */
const githubRepoName = (url?: string) => /^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(url ?? '')?.[1];

const LIVE_LAB_STATES = ['provisioning', 'running', 'stopped'];

/**
 * Take a trainee off this list (a trainee who left, a failed run) and, by default, delete their
 * GitHub repo. The server refuses to delete any repo it can't prove is this trainee's own lab
 * repo, and removes nothing when the delete fails.
 */
function RemoveTrainee({ row, onChanged }: { row: TraineeRow; onChanged: () => void }) {
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const repoName = githubRepoName(row.repoUrl);
  const [deleteRepo, setDeleteRepo] = useState(true);
  const c = row.capstone;
  const labLive = LIVE_LAB_STATES.includes(row.environment.state);
  const willDelete = Boolean(repoName) && deleteRepo;

  const remove = async () => {
    setBusy(true);
    setError(undefined);
    try {
      const r = await api.removeTrainee({
        agentId: row.agentId,
        resourceName: row.agentId ? row.resourceName : undefined,
        enrollmentId: c?.id,
        deleteRepo: willDelete,
      });
      alertApi.post({
        message: `Removed ${row.traineeEmail}${r.repoDeleted ? ` and deleted ${r.repoDeleted}` : ''}`,
        severity: 'success',
        display: 'transient',
      });
      setOpen(false);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        data-destructive
        startIcon={<Trash2 size={14} strokeWidth={1.5} />}
        onClick={() => {
          setError(undefined);
          setOpen(true);
        }}
      >
        Remove trainee
      </Button>
      <Dialog open={open} onClose={() => !busy && setOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>Remove {row.traineeEmail}?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            Takes <strong>{row.resourceName}</strong> off this list
            {c ? <> and withdraws their {c.capstone} capstone enrollment (#{c.traineeNo}), freeing the number</> : null}.
          </Typography>
          {repoName ? (
            <FormControlLabel
              control={<Checkbox checked={deleteRepo} onChange={e => setDeleteRepo(e.target.checked)} disabled={busy} />}
              label={
                <Typography variant="body2">
                  Also delete the GitHub repository <strong>{repoName}</strong>. This is permanent: their commits, pull requests and CI
                  history are gone.
                </Typography>
              }
            />
          ) : (
            <Typography variant="body2" color="textSecondary" gutterBottom>
              {row.repoUrl ? `Their repository (${row.repoUrl}) is not on GitHub and is not deleted.` : 'There is no repository to delete.'}
            </Typography>
          )}
          {labLive && (
            <Box mt={1.5}>
              <Alert severity="warning">
                Their lab is still on their laptop ({row.environment.state}). It stays there until they remove it from their Local
                Provisioner page{willDelete ? '; with the repository deleted, its CI runner stops working' : ''}.
              </Alert>
            </Box>
          )}
          {error && (
            <Box mt={1.5}>
              <Alert severity="error">Not removed: {error}</Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={busy}>
            Cancel
          </Button>
          <Button disabled={busy} data-destructive onClick={remove}>
            {busy && 'Removing…'}
            {!busy && (willDelete ? 'Remove and delete repository' : 'Remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

const STATE_COLOR: Record<string, string> = {
  running: '#079669',
  provisioning: '#d97706',
  stopped: '#8f8f8f',
  removed: '#8f8f8f',
  error: '#e5484d',
};

/** "3h ago" style relative time. */
export function relativeTime(iso: string | undefined, now: Date = new Date()): string {
  if (!iso) return '—';
  const sec = Math.max(0, (now.getTime() - Date.parse(iso)) / 1000);
  if (sec < 60) return 'just now';
  const min = sec / 60;
  if (min < 60) return `${Math.floor(min)}m ago`;
  const h = min / 60;
  if (h < 24) return `${Math.floor(h)}h ago`;
  const d = h / 24;
  return d < 30 ? `${Math.floor(d)}d ago` : new Date(iso).toLocaleDateString();
}

const commitsLast7 = (row: TraineeRow) =>
  (row.repo?.commitsPerDay ?? []).slice(-7).reduce((sum, d) => sum + d.count, 0);

const catalogHref = (ref?: string) => {
  if (!ref) return undefined;
  try {
    const { kind, namespace, name } = parseEntityRef(ref);
    return `/catalog/${namespace ?? 'default'}/${kind.toLowerCase()}/${name}`;
  } catch {
    return undefined;
  }
};

function CommitStrip({ days }: { days: { date: string; count: number }[] }) {
  const classes = useStyles();
  const max = Math.max(1, ...days.map(d => d.count));
  return (
    <div className={classes.strip} aria-label="commits per day, last 14 days">
      {days.map(d => (
        <Tooltip key={d.date} title={`${d.date}: ${d.count} commit${d.count === 1 ? '' : 's'}`}>
          {d.count > 0 ? (
            <div className={classes.bar} style={{ height: 4 + Math.round((d.count / max) * 24) }} />
          ) : (
            <div className={classes.barEmpty} />
          )}
        </Tooltip>
      ))}
    </div>
  );
}

function TraineeDetail({ row, onChanged }: { row: TraineeRow; onChanged: () => void }) {
  const classes = useStyles();
  const repo = row.repo;
  const catalog = catalogHref(row.catalogEntityRef);
  return (
    <div className={classes.detail}>
      {repo ? (
        <>
          <div className={classes.sectionLabel}>Commits, last 14 days</div>
          <CommitStrip days={repo.commitsPerDay} />
          <div className={classes.sectionLabel}>Stage files worked on</div>
          {repo.stageFilesWorked.length ? (
            repo.stageFilesWorked.map(f => (
              <span key={f} className={classes.pill}>
                {f}
              </span>
            ))
          ) : (
            <Typography className={classes.muted}>None yet — only the template's versions.</Typography>
          )}
          {repo.truncatedTree && (
            <Typography className={classes.muted}>Repository tree is very large; file data may be partial.</Typography>
          )}
          {repo.lastCommit && (
            <>
              <div className={classes.sectionLabel}>Last commit</div>
              <Typography variant="body2">
                <span className={classes.mono}>{repo.lastCommit.sha.slice(0, 7)}</span> {repo.lastCommit.message}{' '}
                <span className={classes.muted}>
                  · {repo.lastCommit.author} · {relativeTime(repo.lastCommit.date)}
                </span>
              </Typography>
            </>
          )}
        </>
      ) : (
        <Typography className={classes.muted}>{row.repoNote}</Typography>
      )}
      {row.capstone && <CapstonePanel row={row} onChanged={onChanged} />}
      <div className={classes.sectionLabel}>Environment history</div>
      {row.events.map((e, i) => (
        <Typography key={i} variant="body2" className={classes.muted}>
          {new Date(e.at).toLocaleString()} — {e.type} ({e.status})
        </Typography>
      ))}
      <Box mt={1.5} display="flex" style={{ gap: 8 }}>
        {repo && (
          <Button size="small" href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" endIcon={<ExternalLink size={14} strokeWidth={1.5} />}>
            Repository
          </Button>
        )}
        {repo?.ci && (
          <Button size="small" href={repo.ci.htmlUrl} target="_blank" rel="noopener noreferrer" endIcon={<ExternalLink size={14} strokeWidth={1.5} />}>
            Latest CI run
          </Button>
        )}
        {catalog && (
          <Button size="small" component={RouterLink} to={catalog}>
            Catalog
          </Button>
        )}
        <Box flexGrow={1} />
        <RemoveTrainee row={row} onChanged={onChanged} />
      </Box>
    </div>
  );
}

function noCommitLabel(row: TraineeRow): string {
  if (row.repo?.empty) return 'empty repo';
  return row.repoNote ? 'no data' : '—';
}

function ciLabel(row: TraineeRow): { text: string; color?: string } {
  const ci = row.repo?.ci;
  if (!ci) return { text: '—' };
  if (ci.status !== 'completed') return { text: ci.status, color: '#d97706' };
  if (ci.conclusion === 'success') return { text: 'passing', color: '#079669' };
  return { text: ci.conclusion ?? 'unknown', color: '#e5484d' };
}

export const TraineesPage = () => {
  const classes = useStyles();
  const api = useApi(localProvisionerApiRef);
  const [rows, setRows] = useState<TraineeRow[] | null>(null);
  const [error, setError] = useState<{ message: string; status?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(
    async (refresh = false) => {
      setLoading(true);
      try {
        setRows(await api.getTrainees({ refresh }));
        setError(null);
      } catch (e: any) {
        setError({ message: e.message, status: e.status });
      } finally {
        setLoading(false);
      }
    },
    [api],
  );
  useEffect(() => {
    load();
  }, [load]);

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!rows) return [];
    if (!q) return rows;
    return rows.filter(r => `${r.traineeEmail} ${r.lab ?? ''} ${r.resourceName}`.toLowerCase().includes(q));
  }, [rows, filter]);

  return (
    <Page themeId="tool">
      <Header title="Trainees" subtitle="Every trainee's lab and capstone environment, with the work in their repository" />
      <Content>
        {error?.status === 403 ? (
          <Alert severity="info">The Trainees view is for instructors and admins.</Alert>
        ) : (
          <InfoCard
            title={`Trainees${rows ? ` (${visible.length})` : ''}`}
            action={
              <Box display="flex" alignItems="center" style={{ gap: 8 }}>
                <TextField size="small" variant="outlined" placeholder="Filter by trainee or lab" value={filter} onChange={e => setFilter(e.target.value)} />
                <Tooltip title="Refresh from GitHub (bypasses the 5-minute cache)">
                  <span>
                    <IconButton size="small" aria-label="refresh" disabled={loading} onClick={() => load(true)}>
                      <RefreshCw size={16} strokeWidth={1.5} />
                    </IconButton>
                  </span>
                </Tooltip>
              </Box>
            }
          >
            {error && <Alert severity="error">{error.message}</Alert>}
            {!error && loading && !rows && <Typography className={classes.muted}>Loading trainees and their repositories…</Typography>}
            {rows && visible.length === 0 && (
              <div className={classes.emptyState}>
                <GraduationCap size={28} strokeWidth={1.5} />
                <Typography>{rows.length === 0 ? 'No one has provisioned a training lab yet.' : 'No trainee matches the filter.'}</Typography>
              </div>
            )}
            {rows && visible.length > 0 && (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell padding="checkbox" />
                      <TableCell>Trainee</TableCell>
                      <TableCell>Lab</TableCell>
                      <TableCell>Environment</TableCell>
                      <TableCell>Progress</TableCell>
                      <TableCell>Last commit</TableCell>
                      <TableCell align="right">Commits 7d</TableCell>
                      <TableCell align="right">Stage files</TableCell>
                      <TableCell align="right">AI logs</TableCell>
                      <TableCell align="right">Corrections</TableCell>
                      <TableCell align="right">Decisions</TableCell>
                      <TableCell align="right">PRs</TableCell>
                      <TableCell>CI</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {visible.map(row => {
                      const key = `${row.traineeEmail}::${row.resourceName}`;
                      const isOpen = open === key;
                      const ci = ciLabel(row);
                      const repo = row.repo;
                      return (
                        <React.Fragment key={key}>
                          <TableRow hover style={{ cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : key)}>
                            <TableCell padding="checkbox">
                              {isOpen ? <ChevronDown size={16} strokeWidth={1.5} /> : <ChevronRight size={16} strokeWidth={1.5} />}
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2">{row.traineeEmail}</Typography>
                              <Typography className={classes.muted}>{row.resourceName}</Typography>
                            </TableCell>
                            <TableCell>
                              {row.lab ?? row.taskType}
                              {row.capstone && <Typography className={classes.muted}>trainee #{row.capstone.traineeNo}</Typography>}
                            </TableCell>
                            <TableCell>
                              <span className={classes.dot} style={{ background: STATE_COLOR[row.environment.state] ?? '#8f8f8f' }} />
                              {row.environment.state === 'none' ? 'no environment' : row.environment.state}
                              {row.environment.current && (
                                <Typography className={classes.muted}>
                                  {row.environment.current.status === 'pending'
                                    ? 'waiting for the agent'
                                    : stepLabel(row.environment.current.step ?? 'starting')}{' '}
                                  · {formatDuration(Date.now() - Date.parse(row.environment.current.since))}
                                </Typography>
                              )}
                              {row.environment.state !== 'none' && (
                                <Typography className={classes.muted}>
                                  agent {row.environment.agentOnline ? 'online' : `offline · ${relativeTime(row.environment.agentLastSeen)}`}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell>{repo?.progress ? `${repo.progress.done}/${repo.progress.total}` : '—'}</TableCell>
                            <TableCell>
                              {repo?.lastCommit ? (
                                <>
                                  <Typography variant="body2">{relativeTime(repo.lastCommit.date)}</Typography>
                                  <Typography className={classes.muted} noWrap style={{ maxWidth: 220 }} title={repo.lastCommit.message}>
                                    {repo.lastCommit.message}
                                  </Typography>
                                </>
                              ) : (
                                <Typography className={classes.muted}>{noCommitLabel(row)}</Typography>
                              )}
                            </TableCell>
                            <TableCell align="right">{repo ? commitsLast7(row) : '—'}</TableCell>
                            <TableCell align="right">{repo ? repo.stageFilesWorked.length : '—'}</TableCell>
                            <TableCell align="right">{repo ? repo.aiLogFiles : '—'}</TableCell>
                            <TableCell align="right">{repo ? repo.corrections : '—'}</TableCell>
                            <TableCell align="right">{repo ? repo.decisions : '—'}</TableCell>
                            <TableCell align="right">{repo ? `${repo.pullRequests.open} open · ${repo.pullRequests.merged} merged` : '—'}</TableCell>
                            <TableCell style={{ color: ci.color }}>{ci.text}</TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell colSpan={13} style={{ padding: 0, borderBottom: isOpen ? undefined : 'none' }}>
                              <Collapse in={isOpen} unmountOnExit>
                                <TraineeDetail row={row} onChanged={() => load(true)} />
                              </Collapse>
                            </TableCell>
                          </TableRow>
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </InfoCard>
        )}
      </Content>
    </Page>
  );
};
