import React, { useMemo, useState } from 'react';
import { Table as BackstageTable, TableColumn } from '@backstage/core-components';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, makeStyles, Typography } from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { Archive, Trash2 } from 'lucide-react';
import { useColors } from '@stratpoint/theme-utils';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { daysLeft, formatRetention } from '../../api/archive';
import { TraineeListRow } from '../../api/types';
import { matchesSearch } from './traineeView';

const useStyles = makeStyles(theme => ({
  muted: { color: theme.palette.text.secondary, fontSize: '0.75rem' },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: theme.spacing(1), padding: theme.spacing(4), color: theme.palette.text.secondary },
  list: { margin: theme.spacing(1, 0), paddingLeft: theme.spacing(2.5), maxHeight: 220, overflow: 'auto' },
}));

const keyOf = (row: TraineeListRow) => row.capstone!.id;
const day = (iso?: string) => (iso ? new Date(iso).toLocaleDateString() : '—');

/**
 * The capstones an instructor marked done. Kept for the archive retention, then deleted by the nightly clean-up; here an instructor
 * can delete any of them earlier. Deleting one is the same removal as "Remove trainee" without touching GitHub: the kept report is
 * discarded and the trainee leaves the list. Their repository and the lab on their laptop stay as they are.
 */
export function ArchiveTable({ rows, loading, onChanged, onOpen, infoIcon }: { rows: TraineeListRow[]; loading: boolean; onChanged: () => void; onOpen: (row: TraineeListRow) => void; infoIcon: React.ReactNode }) {
  const classes = useStyles();
  const c0 = useColors();
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  const chosen = useMemo(() => rows.filter(r => selected.has(keyOf(r))), [rows, selected]);
  const retention = rows.find(r => r.capstone?.archiveRetentionDays)?.capstone?.archiveRetentionDays;

  const close = () => {
    if (!busy) {
      setConfirming(false);
      setFailures([]);
    }
  };

  const deleteChosen = async () => {
    setBusy(true);
    setFailures([]);
    const failed: string[] = [];
    let deleted = 0;
    for (const row of chosen) {
      try {
        await api.removeTrainee({
          agentId: row.agentId,
          resourceName: row.agentId ? row.resourceName : undefined,
          enrollmentId: row.capstone!.id,
          deleteRepo: false,
        });
        deleted += 1;
      } catch (e: any) {
        failed.push(`${row.traineeEmail} (${row.capstone!.capstone} #${row.capstone!.traineeNo}): ${e.message}`);
      }
    }
    setBusy(false);
    if (deleted) {
      alertApi.post({ message: `Deleted ${deleted} archived capstone${deleted === 1 ? '' : 's'}`, severity: 'success', display: 'transient' });
      onChanged();
    }
    if (failed.length) {
      setFailures(failed);
    } else {
      setConfirming(false);
    }
  };

  const columns = useMemo<Array<TableColumn<TraineeListRow>>>(
    () => [
      {
        title: 'Trainee',
        field: 'traineeEmail',
        customFilterAndSearch: (term: string, row: TraineeListRow) => matchesSearch(row, term),
        render: row => (
          <>
            <Typography variant="body2">{row.traineeEmail}</Typography>
            <Typography className={classes.muted}>{row.resourceName}</Typography>
          </>
        ),
      },
      {
        title: 'Capstone',
        field: 'lab',
        searchable: false,
        render: row => (
          <>
            {row.lab ?? row.capstone!.capstone}
            <Typography className={classes.muted}>trainee #{row.capstone!.traineeNo}</Typography>
          </>
        ),
      },
      {
        title: 'Marked done',
        field: 'completedAt',
        searchable: false,
        customSort: (a: TraineeListRow, b: TraineeListRow) => Date.parse(a.capstone!.completedAt ?? '') - Date.parse(b.capstone!.completedAt ?? '') || 0,
        render: row => (
          <>
            {day(row.capstone!.completedAt)}
            {row.capstone!.completedBy && <Typography className={classes.muted}>by {row.capstone!.completedBy}</Typography>}
          </>
        ),
      },
      {
        title: 'Kept until',
        field: 'archiveExpiresAt',
        searchable: false,
        customSort: (a: TraineeListRow, b: TraineeListRow) => Date.parse(a.capstone!.archiveExpiresAt ?? '') - Date.parse(b.capstone!.archiveExpiresAt ?? '') || 0,
        render: row => {
          const left = daysLeft(row.capstone!.archiveExpiresAt);
          return (
            <>
              {day(row.capstone!.archiveExpiresAt)}
              {left !== undefined && <Typography className={classes.muted}>{left === 1 ? '1 day left' : `${left} days left`}</Typography>}
            </>
          );
        },
      },
      {
        title: 'Report',
        field: 'hasReport',
        searchable: false,
        customSort: (a: TraineeListRow, b: TraineeListRow) => Number(!!a.capstone!.hasReport) - Number(!!b.capstone!.hasReport),
        render: row => (row.capstone!.hasReport ? 'kept' : 'none'),
      },
    ],
    [classes],
  );

  return (
    <>
      {/* The same note box as User Management's. */}
      <Box display="flex" alignItems="flex-start" style={{ background: c0.surfaceSubtle, border: `1px solid ${c0.border}`, borderRadius: 8, padding: '12px 16px', marginBottom: 20, gap: 8 }}>
        <span style={{ flexShrink: 0, marginTop: 2, display: 'flex' }}>{infoIcon}</span>
        <Typography style={{ fontSize: '0.8125rem', color: c0.textMuted }}>
          {retention ? `Capstones marked done are kept for ${formatRetention(retention)}, then deleted. ` : 'Capstones marked done are kept here, then deleted. '}
          Delete any of them earlier by ticking them. Their GitHub repositories and the labs on their laptops are not touched.
        </Typography>
      </Box>
      <BackstageTable<TraineeListRow>
        title={`${rows.length} archived`}
        data={rows}
        columns={columns}
        isLoading={loading}
        emptyContent={
          <div className={classes.empty}>
            <Archive size={28} strokeWidth={1.5} aria-hidden="true" />
            <Typography>Nothing is archived. A capstone you mark done moves here.</Typography>
          </div>
        }
        options={{ search: true, paging: true, pageSize: 10, pageSizeOptions: [10, 25, 50], padding: 'dense', selection: true, showTextRowsSelected: false, emptyRowsWhenPaging: false }}
        onSelectionChange={picked => setSelected(new Set(picked.map(r => keyOf(r as TraineeListRow))))}
        onRowClick={(_event, row) => row && onOpen(row)}
        actions={[{ icon: () => <Trash2 size={16} strokeWidth={1.5} />, tooltip: 'Delete selected', onClick: () => setConfirming(true) }]}
      />

      <Dialog open={confirming} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>
          Delete {chosen.length} archived capstone{chosen.length === 1 ? '' : 's'}?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            The kept report of each is deleted for good and they leave the list.
          </Typography>
          <ul className={classes.list}>
            {chosen.map(r => (
              <li key={keyOf(r)}>
                {r.traineeEmail} · {r.capstone!.capstone} #{r.capstone!.traineeNo}
              </li>
            ))}
          </ul>
          <Typography variant="body2" color="textSecondary">
            Their GitHub repositories and the labs on their laptops are not touched.
          </Typography>
          {failures.length > 0 && (
            <Box mt={1.5}>
              <Alert severity="error">
                Not deleted:
                <ul style={{ margin: 0, paddingLeft: 18 }}>
                  {failures.map(f => (
                    <li key={f}>{f}</li>
                  ))}
                </ul>
              </Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={deleteChosen} disabled={busy || chosen.length === 0} data-destructive variant="outlined">
            {busy ? 'Deleting…' : `Delete ${chosen.length}`}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
