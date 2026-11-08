import React, { useContext, useEffect, useMemo } from 'react';
import { Table as BackstageTable, TableColumn } from '@backstage/core-components';
import { IconButton, Typography, useMediaQuery } from '@material-ui/core';
import { CheckCircle, ChevronRight, Loader, XCircle } from 'lucide-react';
import { formatDuration, stepLabel } from '../../api/activity';
import type { TraineeActivityItem, TraineeListRow, TraineeRepoActivity } from '../../api/types';
import { ActivityContext, useEntry } from './activity';
import type { ActivityEntry } from './activityQueue';
import { AttentionBadge } from './attentionBadge';
import { relativeTime } from './helpers';
import { usePageStyles } from './pageStyles';
import { Pill, STATE_TEXT, StatePill } from './Pill';
import {
  attentionOf,
  canHaveActivity,
  compareAttention,
  compareBy,
  compareLab,
  compareName,
  courseOf,
  isCiFailing,
  matchesSearch,
  prettyCourse,
  SortValues,
} from './traineeView';

/** A grey bar the size of the value that will replace it, so nothing moves when the data arrives. */
function Skeleton({ width = 60 }: { width?: number }) {
  const classes = usePageStyles();
  return <span className={classes.skeleton} style={{ width }} role="img" aria-label="loading" />;
}

function ciCell(item: TraineeActivityItem, repo: TraineeRepoActivity, dash: React.ReactNode): React.ReactNode {
  if (!repo.ci) return dash;
  if (repo.ci.status !== 'completed') return <Pill tone="blue" icon={<Loader size={12} strokeWidth={2} aria-hidden="true" />}>{repo.ci.status.replace('_', ' ')}</Pill>;
  if (repo.ci.conclusion === 'success') return <Pill tone="green" icon={<CheckCircle size={12} strokeWidth={2} aria-hidden="true" />}>passing</Pill>;
  if (isCiFailing(item)) return <Pill tone="red" icon={<XCircle size={12} strokeWidth={2} aria-hidden="true" />}>{repo.ci.conclusion ?? 'failing'}</Pill>;
  return <span>{repo.ci.conclusion ?? 'unknown'}</span>;
}

/** The second line under a lab's state: what the agent is doing, or whether it is online. */
function labDetail(env: TraineeListRow['environment'], now: number): string {
  if (env.current) {
    const what = env.current.status === 'pending' ? 'waiting for the agent' : stepLabel(env.current.step ?? 'starting');
    return `${what} · ${formatDuration(now - Date.parse(env.current.since))}`;
  }
  if (env.state === 'none') return 'repository only';
  return `agent ${env.agentOnline ? 'online' : `offline · ${relativeTime(env.agentLastSeen)}`}`;
}

type Part = 'progress' | 'last' | 'spark' | 'ci';

function githubCells(row: TraineeListRow, entry: ActivityEntry | undefined, classes: ReturnType<typeof usePageStyles>): Record<Part, React.ReactNode> {
  const dash = <span className={classes.none}>—</span>;
  if (!row.hasGithubRepo) return { progress: dash, last: <span className={classes.none}>no repository</span>, spark: null, ci: dash };
  if (row.capstone?.status === 'completed') return { progress: dash, last: <span className={classes.none}>archived</span>, spark: null, ci: dash };
  const item: TraineeActivityItem | undefined = entry?.item;
  const waiting = !entry || entry.status !== 'done';
  // A refresh keeps the old values on screen; only a row that has never been read shows grey bars.
  if (!item || item.code !== 'ok' || !item.repo) {
    if (waiting) return { progress: <Skeleton />, last: <Skeleton width={90} />, spark: <Skeleton width={84} />, ci: <Skeleton width={50} /> };
    const why = entry?.missing ? 'no longer on the list' : item?.note ?? 'GitHub data not available';
    return { progress: dash, last: <span className={classes.none} title={why}>not available</span>, spark: null, ci: dash };
  }
  const repo = item.repo as TraineeRepoActivity;
  const progress = repo.progress ? (
    <div className={classes.progress}>
      <span className={classes.progressBar}>
        <span className={classes.progressFill} style={{ width: `${(repo.progress.done / repo.progress.total) * 100}%`, display: 'block' }} />
      </span>
      {repo.progress.done}/{repo.progress.total}
    </div>
  ) : (
    dash
  );
  const last = repo.lastCommit ? (
    <>
      {relativeTime(repo.lastCommit.date)}
      <span className={`${classes.sub} ${classes.trunc}`} title={repo.lastCommit.message}>
        {repo.lastCommit.message}
      </span>
    </>
  ) : (
    <span className={classes.none}>{repo.empty ? 'empty repo' : 'no commits'}</span>
  );
  const max = Math.max(1, ...repo.commitsPerDay.map(d => d.count));
  const spark = (
    <div className={classes.spark} role="img" aria-label="Commits per day, last 14 days">
      {repo.commitsPerDay.map(d =>
        d.count > 0 ? <i key={d.date} className={classes.sparkBar} style={{ height: 4 + Math.round((d.count / max) * 18) }} title={`${d.date}: ${d.count} commit${d.count === 1 ? '' : 's'}`} /> : <i key={d.date} className={classes.sparkZero} />,
      )}
    </div>
  );
  return { progress, last, spark, ci: ciCell(item, repo, dash) };
}

function GithubCell({ row, part }: { row: TraineeListRow; part: Part }) {
  const classes = usePageStyles();
  const entry = useEntry(row);
  return <>{githubCells(row, entry, classes)[part]}</>;
}

/** The first cell of a row. A row that is drawn is on screen, so this is where its GitHub data is asked for. */
function TraineeCell({ row }: { row: TraineeListRow }) {
  const classes = usePageStyles();
  const { register } = useContext(ActivityContext);
  const eligible = canHaveActivity(row);
  useEffect(() => (eligible ? register({ key: row.key, repoUrl: row.repoUrl }) : undefined), [eligible, row.key, row.repoUrl, register]);
  return (
    <>
      <Typography variant="body2" className={classes.trunc} title={row.traineeEmail}>
        {row.traineeEmail}
      </Typography>
      <span className={`${classes.sub} ${classes.trunc}`} title={row.resourceName}>
        {prettyCourse(courseOf(row))}
        {row.capstone ? ` · trainee #${row.capstone.traineeNo}` : ''}
      </span>
    </>
  );
}

function AttentionCell({ row }: { row: TraineeListRow }) {
  const entry = useEntry(row);
  return <AttentionBadge attention={attentionOf(row, canHaveActivity(row) ? entry?.item : undefined, Date.now())} />;
}

function LabCell({ row }: { row: TraineeListRow }) {
  const classes = usePageStyles();
  return (
    <>
      <StatePill state={row.environment.state} />
      <span className={classes.sub}>{labDetail(row.environment, Date.now())}</span>
    </>
  );
}

export interface TraineeTableProps {
  /** Each row carries what the GitHub columns are ordered by (`SortValues`), as of when loading last finished. */
  rows: Array<TraineeListRow & SortValues>;
  title: string;
  isLoading: boolean;
  emptyContent: React.ReactNode;
  onOpen(row: TraineeListRow): void;
  /** The column the table is ordered by now (its field), or undefined when it is in its default order (needs attention first). */
  orderField: string | undefined;
  onOrder(field: string | undefined): void;
}

/**
 * The list, drawn by the portal's own table exactly as User Management draws its users: the table's search, header sorting (every
 * column) and paging. The default order is "Needs attention first", from the portal's own data only.
 */
export function TraineeTable({ rows, title, isLoading, emptyContent, onOpen, orderField, onOrder }: TraineeTableProps) {
  // The two columns that matter least leave first on a narrow screen; both are also in the side panel.
  const narrow = useMediaQuery('(max-width:1499.95px)');
  const narrower = useMediaQuery('(max-width:1299.95px)');

  const columns = useMemo<Array<TableColumn<TraineeListRow>>>(() => {
    const by = (field: keyof SortValues) => compareBy(r => (r as TraineeListRow & SortValues)[field]);
    return [
      {
        title: 'Trainee',
        field: 'traineeEmail',
        customSort: compareName,
        // The search box looks at the trainee, the lab, the course, and the lab's state and problem as words ("failed", "terraform").
        customFilterAndSearch: (term: string, row: TraineeListRow) => {
          const needle = term.trim().toLowerCase();
          return matchesSearch(row, term) || (STATE_TEXT[row.environment.state] ?? '').includes(needle) || (row.attention?.text ?? '').toLowerCase().includes(needle);
        },
        render: row => <TraineeCell row={row} />,
      },
      // The table puts a column's defaultSort back whenever its props change, so it is only given while no other column is the order.
      { title: 'Attention', field: 'attention', defaultSort: orderField === undefined ? 'asc' : undefined, searchable: false, customSort: compareAttention, render: row => <AttentionCell row={row} /> },
      { title: 'Lab', field: 'environment', searchable: false, customSort: compareLab, render: row => <LabCell row={row} /> },
      { title: 'Progress', field: 'progress', searchable: false, customSort: by('progressValue'), render: row => <GithubCell row={row} part="progress" /> },
      { title: 'Last commit', field: 'lastCommit', searchable: false, customSort: by('lastCommitValue'), render: row => <GithubCell row={row} part="last" /> },
      { title: '14 days', field: 'commits14', hidden: narrow, searchable: false, customSort: by('commits14Value'), render: row => <GithubCell row={row} part="spark" /> },
      { title: 'CI', field: 'ci', hidden: narrower, searchable: false, customSort: by('ciValue'), render: row => <GithubCell row={row} part="ci" /> },
      {
        title: '',
        field: 'open',
        sorting: false,
        searchable: false,
        render: row => (
          <IconButton size="small" title="Open" aria-label={`Open ${row.traineeEmail}`} onClick={e => { e.stopPropagation(); onOpen(row); }}>
            <ChevronRight size={16} strokeWidth={1.5} />
          </IconButton>
        ),
      },
    ];
  }, [narrow, narrower, onOpen, orderField]);

  return (
    <BackstageTable<TraineeListRow>
      title={title}
      data={rows}
      columns={columns}
      isLoading={isLoading}
      emptyContent={emptyContent}
      // emptyRowsWhenPaging: false, or the table pads a short list to a full page with a blank filler row and the pager sits far below it.
      options={{ search: true, paging: true, pageSize: 10, pageSizeOptions: [10, 25, 50], padding: 'dense', emptyRowsWhenPaging: false }}
      onRowClick={(_event, row) => row && onOpen(row)}
      onOrderChange={(id: number, direction: 'asc' | 'desc') => onOrder(direction ? (columns[id]?.field as string | undefined) : undefined)}
    />
  );
}
