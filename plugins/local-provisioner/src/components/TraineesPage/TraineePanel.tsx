import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Box, Button, Drawer, IconButton, Tab, Tabs, Typography } from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { Link as RouterLink } from 'react-router-dom';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { ExternalLink, X } from 'lucide-react';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import type { TraineeListRow, TraineeRepoActivity, TraineeRow } from '../../api/types';
import { ReportActions, RepoState } from '../LabReport/ReportActions';
import { AttentionBadge } from './attentionBadge';
import { Pill, PillTone, StatePill } from './Pill';
import { CapstoneActions } from './CapstoneActions';
import { catalogHref, relativeTime } from './helpers';
import { LabChecks } from './LabChecks';
import { usePageStyles } from './pageStyles';
import { RemoveTrainee } from './RemoveTrainee';
import { useStyles } from './styles';
import { attentionOf, courseOf, prettyCourse } from './traineeView';

type TabId = 'work' | 'checks' | 'capstone' | 'history';

const EVENT_TONE: Record<string, PillTone> = { completed: 'green', failed: 'red', 'in-progress': 'blue' };

interface Loaded {
  detail: TraineeRow | null | undefined; // undefined: loading, null: no longer exists
  detailError?: string;
  repoState: RepoState;
  repo?: TraineeRepoActivity;
  repoNote?: string;
}

/**
 * One trainee in a side panel. The database part (timeline, every check result) and the GitHub part (the full summary) load
 * separately: a GitHub problem never slows the panel down, and Mark done waits until the repository summary is there or known to be
 * absent, so a report is never kept with "unavailable" in it.
 */
export function TraineePanel({
  rowKey,
  listRow,
  now,
  onClose,
  onChanged,
}: {
  rowKey: string | undefined;
  listRow?: TraineeListRow;
  now: number;
  onClose(): void;
  onChanged(): void;
}) {
  const classes = useStyles();
  const p = usePageStyles();
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const [tab, setTab] = useState<TabId>('work');
  const [state, setState] = useState<Loaded>({ detail: undefined, repoState: 'loading' });

  const loadRepo = useCallback(
    async (key: string, refresh: boolean, isCurrent: () => boolean) => {
      setState(s => ({ ...s, repoState: 'loading' }));
      try {
        const [item] = await api.getTraineeActivity([key], 'full', refresh);
        if (!isCurrent()) return;
        if (item?.code === 'ok' && item.repo) setState(s => ({ ...s, repoState: 'ready', repo: item.repo as TraineeRepoActivity, repoNote: undefined }));
        else if (!item || item.code === 'no_repo' || item.code === 'archived' || item.code === 'not_found') {
          setState(s => ({ ...s, repoState: 'absent', repo: undefined, repoNote: item?.note ?? (item ? undefined : 'No longer on the list') }));
        } else setState(s => ({ ...s, repoState: 'failed', repo: undefined, repoNote: item.note }));
      } catch (e: any) {
        if (isCurrent()) setState(s => ({ ...s, repoState: 'failed', repo: undefined, repoNote: e.message }));
      }
    },
    [api],
  );

  useEffect(() => {
    if (!rowKey) return undefined;
    let current = true;
    const isCurrent = () => current;
    setState({ detail: undefined, repoState: 'loading' });
    setTab('work');
    api
      .getTraineeDetail(rowKey)
      .then(detail => current && setState(s => ({ ...s, detail })))
      .catch((e: any) => current && setState(s => ({ ...s, detail: null, detailError: e.message })));
    void loadRepo(rowKey, false, isCurrent);
    return () => {
      current = false;
    };
  }, [api, rowKey, loadRepo]);

  const reloadDetail = useCallback(() => {
    if (!rowKey) return;
    api
      .getTraineeDetail(rowKey)
      .then(detail => setState(s => ({ ...s, detail })))
      .catch((e: any) => alertApi.post({ message: `Could not reload the trainee: ${e.message}`, severity: 'error' }));
    onChanged();
  }, [api, alertApi, rowKey, onChanged]);

  const { detail, repo, repoState, repoNote } = state;
  const row: TraineeRow | undefined = useMemo(() => (detail ? { ...detail, repo, repoNote } : undefined), [detail, repo, repoNote]);
  const head = detail ?? listRow;
  const attention = listRow ? attentionOf(listRow, repoState === 'ready' ? { key: listRow.key, fetchedAt: '', code: 'ok', repo } : undefined, now) : undefined;
  const tabs: Array<[TabId, string]> = [['work', 'Work'], ['checks', 'Checks'], ...(head?.capstone ? ([['capstone', 'Capstone']] as Array<[TabId, string]>) : []), ['history', 'History']];
  const catalog = catalogHref(detail?.catalogEntityRef);

  return (
    <Drawer anchor="right" open={!!rowKey} onClose={onClose} PaperProps={{ className: p.panel, 'aria-label': 'Trainee details' } as any}>
      <div className={p.panelHead}>
        <div className={p.panelTitle}>
          <Typography variant="h6" style={{ overflowWrap: 'anywhere' }}>
            {head?.traineeEmail ?? 'Trainee'}
          </Typography>
          {head && (
            <span className={p.sub}>
              {prettyCourse(courseOf(head as TraineeListRow))}
              {head.capstone ? ` · trainee #${head.capstone.traineeNo}` : ''}
            </span>
          )}
          {head && <span className={`${p.sub} ${classes.mono}`}>{head.resourceName}</span>}
        </div>
        <IconButton size="small" aria-label="Close" onClick={onClose}>
          <X size={18} strokeWidth={1.5} />
        </IconButton>
      </div>

      {head && (
        <div className={p.badges}>
          {attention && <AttentionBadge attention={attention} />}
          <StatePill state={head.environment.state} />
          {head.capstone?.status === 'completed' && <Pill tone="green">capstone done</Pill>}
        </div>
      )}

      {row && (
        <div className={p.actions}>
          <ReportActions row={row} onChanged={reloadDetail} repoState={repoState} onRetryRepo={() => rowKey && loadRepo(rowKey, true, () => true)} />
        </div>
      )}

      {detail === undefined && <Typography className={classes.muted}>Loading…</Typography>}
      {detail === null && (
        <Box>
          <Alert severity="info">
            {state.detailError ? `Could not load this trainee: ${state.detailError}` : 'This trainee is no longer on the list. It may have been removed or marked done.'}
          </Alert>
          <Box mt={1.5}>
            <Button variant="outlined" onClick={onClose}>
              Close
            </Button>
          </Box>
        </Box>
      )}

      {row && (
        <>
          {/* Plain tabs, as everywhere else in the portal: an underline, no background. */}
          <Tabs value={tab} onChange={(_e, v) => setTab(v)} textColor="primary" indicatorColor="primary" variant="scrollable" scrollButtons="off" aria-label="Trainee sections" className={p.tabs}>
            {tabs.map(([id, label]) => (
              <Tab key={id} value={id} label={label} />
            ))}
          </Tabs>
          <div role="tabpanel">
            {tab === 'work' && <WorkTab row={row} repoState={repoState} onRetry={() => rowKey && loadRepo(rowKey, true, () => true)} catalog={catalog} />}
            {tab === 'checks' && <LabChecks row={row} onChanged={reloadDetail} />}
            {tab === 'capstone' && row.capstone && <CapstoneActions row={row} onChanged={reloadDetail} />}
            {tab === 'history' && (
              <div className={p.section}>
                {row.events.map((e, i) => (
                  <div key={i} className={p.history}>
                    <span style={{ flex: 1 }}>{e.type}</span>
                    <Pill tone={EVENT_TONE[e.status] ?? 'gray'}>{e.status}</Pill>
                    <span className={p.sub}>{new Date(e.at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className={p.danger}>
            <div>
              <Typography variant="body2" style={{ fontWeight: 600 }}>
                Danger zone
              </Typography>
              <span className={p.sub}>Takes them off this list. You choose whether their GitHub repository is deleted.</span>
            </div>
            <RemoveTrainee row={row} onChanged={() => { onClose(); onChanged(); }} />
          </div>
        </>
      )}
    </Drawer>
  );
}

function Kv({ label, children }: { label: string; children: React.ReactNode }) {
  const p = usePageStyles();
  return (
    <div className={p.kv}>
      <span className={p.kvKey}>{label}</span>
      <span className={p.kvValue}>{children}</span>
    </div>
  );
}

function WorkTab({ row, repoState, onRetry, catalog }: { row: TraineeRow; repoState: RepoState; onRetry(): void; catalog?: string }) {
  const p = usePageStyles();
  const classes = useStyles();
  const repo = row.repo;
  return (
    <>
      {repoState === 'loading' && <Typography className={classes.muted}>Loading the repository from GitHub…</Typography>}
      {repoState === 'failed' && (
        <Alert severity="warning" action={<Button variant="outlined" onClick={onRetry}>Retry</Button>}>
          GitHub data could not be loaded{row.repoNote ? `: ${row.repoNote}` : ''}.
        </Alert>
      )}
      {repoState === 'absent' && <Typography className={classes.muted}>{row.repoNote ?? 'No repository data.'}</Typography>}
      {repo && (
        <>
          <div className={p.section}>
            <div className={p.sectionTitle}>Commits, last 14 days</div>
            <div className={p.bigBars} role="img" aria-label="Commits per day, last 14 days">
              {repo.commitsPerDay.map(d => {
                const max = Math.max(1, ...repo.commitsPerDay.map(x => x.count));
                return d.count > 0 ? <i key={d.date} className={p.bigBar} style={{ height: Math.max(6, (d.count / max) * 56) }} title={`${d.date}: ${d.count}`} /> : <i key={d.date} className={p.bigBarZero} />;
              })}
            </div>
            <div className={p.axis}>
              <span>14 days ago</span>
              <span>today</span>
            </div>
          </div>

          <div className={p.section}>
            <div className={p.sectionTitle}>Progress</div>
            <Kv label="Tasks done">{repo.progress ? `${repo.progress.done}/${repo.progress.total}` : '—'}</Kv>
            <Kv label="AI log files">{repo.aiLogFiles}</Kv>
            <Kv label="Corrections">{repo.corrections}</Kv>
            <Kv label="Decisions">{repo.decisions}</Kv>
            <Kv label="Pull requests">{repo.pullRequests.open} open · {repo.pullRequests.merged} merged</Kv>
            {repo.lastCommit && (
              <Kv label="Last commit">
                <span className={classes.mono}>{repo.lastCommit.sha.slice(0, 7)}</span> <span>{repo.lastCommit.message}</span> · {repo.lastCommit.author} · {relativeTime(repo.lastCommit.date)}
              </Kv>
            )}
          </div>

          <div className={p.section}>
            <div className={p.sectionTitle}>Stage files worked on</div>
            {repo.stageFilesWorked.length ? (
              <div className={p.pills}>
                {repo.stageFilesWorked.map(f => (
                  <Pill key={f} tone="gray">
                    {f}
                  </Pill>
                ))}
              </div>
            ) : (
              <Typography className={classes.muted}>None yet — only the template's versions.</Typography>
            )}
            {repo.truncatedTree && <Typography className={classes.muted}>Repository tree is very large; file data may be partial.</Typography>}
          </div>
        </>
      )}
      <div className={p.links}>
        {repo && <Button variant="outlined" href={repo.htmlUrl} target="_blank" rel="noopener noreferrer" endIcon={<ExternalLink size={16} strokeWidth={1.5} />}>Repository</Button>}
        {repo?.ci && <Button variant="outlined" href={repo.ci.htmlUrl} target="_blank" rel="noopener noreferrer" endIcon={<ExternalLink size={16} strokeWidth={1.5} />}>Latest CI run</Button>}
        {catalog && <Button variant="outlined" component={RouterLink} to={catalog}>Catalog</Button>}
      </div>
    </>
  );
}
