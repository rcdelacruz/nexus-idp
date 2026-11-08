import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Content, Header, Page } from '@backstage/core-components';
import { Box, Button, IconButton, Tab, Tabs, Tooltip, Typography } from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { useSearchParams } from 'react-router-dom';
import { Archive, GraduationCap, Info, RefreshCw, Users } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { isArchived } from '../../api/archive';
import type { TraineeListRow } from '../../api/types';
import { useTraineeActivity } from '../../hooks/useTraineeActivity';
import { useTraineeList } from '../../hooks/useTraineeList';
import { ActivityContext, useVisibleRows } from './activity';
import { ArchiveTable } from './ArchiveTable';
import { usePageStyles } from './pageStyles';
import { TraineePanel } from './TraineePanel';
import { TraineeTable } from './TraineeTable';
import type { TraineeActivityItem } from '../../api/types';
import { canHaveActivity, compareAttention, parseView, sortValuesOf, ViewState, viewToParams } from './traineeView';

export { checkSummary } from '../../api/checkSummary';
export { relativeTime } from './helpers';

/** The columns that are ordered by GitHub data: choosing one of them loads everyone's data first. */
const GITHUB_COLUMNS = ['progress', 'lastCommit', 'commits14', 'ci'];

/** Counts down while GitHub's rate limit is being waited out. */
function useCountdown(until: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === undefined) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [until]);
  return until === undefined ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

export const TraineesPage = () => {
  const classes = usePageStyles();
  const c = useColors();
  const [params, setParams] = useSearchParams();
  const view = useMemo(() => parseView(params), [params]);
  // The Active / Archive switch replaces the current address; opening a trainee is a step you can go back from.
  const setView = useCallback(
    (changes: Partial<ViewState>, opts: { push?: boolean } = {}) => setParams(viewToParams({ ...view, ...changes }), { replace: !opts.push }),
    [view, setParams],
  );

  const { rows, error, loading, reload } = useTraineeList();
  const { queue, version } = useTraineeActivity();
  const { register, visibleTargets } = useVisibleRows(queue);
  const activity = useMemo(() => ({ queue, version, register }), [queue, version, register]);

  const active = useMemo(() => (rows ?? []).filter(r => !isArchived(r)), [rows]);
  const archived = useMemo(() => (rows ?? []).filter(isArchived), [rows]);

  // Ordering by a GitHub column: everyone's data is loaded first (the rows on screen are already in front), and the order is applied
  // once, from what has been loaded, instead of moving rows as each answer arrives. The answers the order is made from are taken when
  // loading finishes and travel on the rows, so the table re-orders when they change.
  const [orderField, setOrderField] = useState<string | undefined>();
  const githubOrder = !!orderField && GITHUB_COLUMNS.includes(orderField);
  const [answers, setAnswers] = useState<Map<string, TraineeActivityItem>>(() => new Map());
  const busy = queue ? queue.busy > 0 : false;
  useEffect(() => {
    if (!queue || !githubOrder) return;
    const targets = active.filter(canHaveActivity).map(r => ({ key: r.key, repoUrl: r.repoUrl }));
    if (targets.length) queue.enqueue(targets);
  }, [queue, githubOrder, active]);
  useEffect(() => {
    if (!queue || !githubOrder || busy) return;
    setAnswers(new Map(active.flatMap(r => { const item = queue.get(r.key, r.repoUrl)?.item; return item ? [[r.key, item] as const] : []; })));
  }, [queue, githubOrder, busy, version, active]);

  // The table writes a few fields onto the rows it is given, so it gets copies. Each has an `id` (the table warns about losing its state
  // between renders without one). Everything else the table is given must keep its identity from one render to the next (`empty` below
  // is memoized): when a prop such as the empty-state element changes, the table draws every row from scratch, and every cell asks GitHub again.
  const tableRows = useMemo(() => [...active].sort(compareAttention).map(r => ({ ...r, id: r.key, ...sortValuesOf(answers.get(r.key)) })), [active, answers]);
  const archiveRows = useMemo(() => archived.map(r => ({ ...r, id: r.key })), [archived]);

  const wait = useCountdown(queue?.pausedUntil);
  const eligible = useMemo(() => active.filter(canHaveActivity), [active]);
  const progress = queue ? queue.progress(eligible.map(r => ({ key: r.key, repoUrl: r.repoUrl }))) : { done: 0, total: eligible.length };
  void version; // the counts above change as answers arrive

  const refresh = () => {
    void reload();
    if (queue) queue.enqueue(visibleTargets(), { front: true, refresh: true });
  };

  // The trainee panel. A `cap:` key from before a lab existed still finds its row, by the enrollment.
  const openRow = useMemo(
    () => (view.open ? (rows ?? []).find(r => r.key === view.open) ?? (view.open.startsWith('cap:') ? (rows ?? []).find(r => r.capstone?.id === view.open!.slice(4)) : undefined) : undefined),
    [rows, view.open],
  );
  const open = useCallback((r: TraineeListRow) => setView({ open: r.key }, { push: true }), [setView]);

  const needAttention = active.filter(r => r.attention).length;
  const noTrainees = !!rows && rows.length === 0;
  const empty = useMemo(
    () => (
    <div className={classes.empty}>
      <GraduationCap size={28} strokeWidth={1.5} aria-hidden="true" />
      <Typography>{noTrainees ? 'No one has provisioned a training lab yet.' : 'No active trainees. Capstones marked done are in the Archive.'}</Typography>
      {!noTrainees && (
        <Button size="small" variant="outlined" onClick={() => setView({ tab: 'archive' })}>
          Open the Archive
        </Button>
      )}
    </div>
    ),
    [classes.empty, noTrainees, setView],
  );

  return (
    <Page themeId="tool">
      <Header title="Trainees" subtitle="Every trainee's lab and capstone environment, with the work in their repository" />
      <Content>
        {error?.status === 403 ? (
          <Alert severity="info">The Trainees view is for instructors and admins.</Alert>
        ) : (
          <>
            {/* The same switch as User Management's: plain tabs with an icon and the count, and Refresh at the right. */}
            <Box display="flex" alignItems="center" justifyContent="space-between" style={{ borderBottom: `1px solid ${c.border}`, marginBottom: 20 }}>
              <Tabs value={view.tab} onChange={(_e, tab) => setView({ tab })} textColor="primary" indicatorColor="primary" aria-label="Trainees views">
                <Tab
                  value="active"
                  label={
                    <Box display="flex" alignItems="center" style={{ gap: 6 }}>
                      <Users size={14} strokeWidth={1.5} aria-hidden="true" />
                      {`Active${rows ? ` (${active.length})` : ''}`}
                    </Box>
                  }
                />
                <Tab
                  value="archive"
                  label={
                    <Box display="flex" alignItems="center" style={{ gap: 6 }}>
                      <Archive size={14} strokeWidth={1.5} aria-hidden="true" />
                      {`Archive${rows ? ` (${archived.length})` : ''}`}
                    </Box>
                  }
                />
              </Tabs>
              <div className={classes.live}>
                {view.tab === 'active' && (
                  <div role="status" style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    {busy && (
                      <span className={classes.meter} aria-hidden="true">
                        <span className={classes.meterFill} style={{ width: `${progress.total === 0 ? 100 : Math.round((progress.done / progress.total) * 100)}%` }} />
                      </span>
                    )}
                    <span>{githubOrder && busy ? `Loading GitHub data for ${progress.total - progress.done} more trainees…` : `GitHub activity ${progress.done} of ${progress.total}`}</span>
                  </div>
                )}
                <Tooltip title="Refresh the list and the GitHub data of the rows on screen">
                  <span>
                    <IconButton size="small" aria-label="Refresh" disabled={loading || busy} onClick={refresh}>
                      <RefreshCw size={16} strokeWidth={1.5} />
                    </IconButton>
                  </span>
                </Tooltip>
              </div>
            </Box>

            {error && (
              <Box className={classes.notice}>
                <Alert severity="error">{error.message}</Alert>
              </Box>
            )}
            {wait > 0 && (
              <Box className={classes.notice}>
                <Alert severity="warning">GitHub is limiting requests. Trying again in {wait} s.</Alert>
              </Box>
            )}

            {view.tab === 'active' && (
              <ActivityContext.Provider value={activity}>
                <TraineeTable
                  rows={tableRows}
                  title={`${active.length} trainees · ${needAttention} need attention`}
                  isLoading={loading && !rows}
                  emptyContent={empty}
                  onOpen={open}
                  orderField={orderField}
                  onOrder={setOrderField}
                />
              </ActivityContext.Provider>
            )}
            {view.tab === 'archive' && <ArchiveTable rows={archiveRows} loading={loading && !rows} onChanged={reload} onOpen={open} infoIcon={<Info size={16} color={c.textMuted} strokeWidth={1.5} aria-hidden="true" />} />}
          </>
        )}
      </Content>
      <TraineePanel rowKey={view.open} listRow={openRow} now={Date.now()} onClose={() => setView({ open: undefined })} onChanged={reload} />
    </Page>
  );
};
