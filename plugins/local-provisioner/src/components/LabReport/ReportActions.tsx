import React, { useState } from 'react';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Typography } from '@material-ui/core';
import { Alert } from '@material-ui/lab';
import { alertApiRef, useApi } from '@backstage/core-plugin-api';
import { CheckCircle2, FileText, RotateCcw } from 'lucide-react';
import { localProvisionerApiRef } from '../../api/LocalProvisionerClient';
import { LabReport, buildLabReport } from '../../api/labReport';
import { formatRetention } from '../../api/archive';
import { TraineeRow } from '../../api/types';
import { LabReportDialog } from './LabReportDialog';

type Confirm = 'done' | 'reopen' | null;

const markDoneHint = (state: RepoState): string | undefined => {
  if (state === 'loading') return 'Waiting for the repository summary from GitHub';
  if (state === 'failed') return 'The repository summary could not be loaded: retry it first';
  return undefined;
};

/**
 * Whether the repository summary that goes into the report is there: `ready`, or known to be absent (no repository, GitLab, not found,
 * archived), or still `loading`, or could not be read (`failed`). Mark done keeps the report for a year, so it waits for ready or absent.
 */
export type RepoState = 'ready' | 'absent' | 'loading' | 'failed';

/**
 * The report buttons of one trainee row.
 *
 * - **Report** (every row): the lab report as it stands now, to read, download or print.
 * - **Mark done** (an active capstone): the instructor says the capstone is finished. The report is
 *   built from what this page shows right now and kept on the server, so it stays the same later even
 *   after the lab is removed or the checks are cleaned up.
 * - **Final report** / **Reopen** (a finished capstone): the kept report, and the way back if it was
 *   marked done by mistake.
 */
export function ReportActions({ row, onChanged, repoState = 'ready', onRetryRepo }: { row: TraineeRow; onChanged: () => void; repoState?: RepoState; onRetryRepo?: () => void }) {
  const api = useApi(localProvisionerApiRef);
  const alertApi = useApi(alertApiRef);
  const [report, setReport] = useState<LabReport | null>(null);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const c = row.capstone;
  const finished = c?.status === 'completed';
  const kept = finished && c?.hasReport;

  const open = async () => {
    if (!kept) {
      setReport(buildLabReport(row));
      return;
    }
    setBusy(true);
    try {
      setReport((await api.getCapstoneReport(c!.id)).report);
    } catch (e: any) {
      alertApi.post({ message: `Could not load the final report: ${e.message}`, severity: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    if (!busy) {
      setConfirm(null);
      setError(undefined);
    }
  };

  const markDone = async () => {
    setBusy(true);
    setError(undefined);
    try {
      // The kept report says "completed", like the row will once this call succeeds.
      await api.completeCapstone(c!.id, buildLabReport({ ...row, capstone: { ...c!, status: 'completed' } }));
      alertApi.post({ message: `${c!.capstone} capstone of ${row.traineeEmail} marked done and moved to the Archive. The report is kept.`, severity: 'success', display: 'transient' });
      setConfirm(null);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const reopen = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await api.reopenCapstone(c!.id);
      alertApi.post({ message: `${c!.capstone} capstone of ${row.traineeEmail} reopened`, severity: 'success', display: 'transient' });
      setConfirm(null);
      onChanged();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outlined" disabled={busy} startIcon={<FileText size={16} strokeWidth={1.5} />} onClick={open}>
        {kept ? 'Final report' : 'Report'}
      </Button>
      {c?.status === 'active' && (
        <>
          <Button
            variant="contained"
            color="primary"
            startIcon={<CheckCircle2 size={16} strokeWidth={1.5} />}
            disabled={repoState === 'loading' || repoState === 'failed'}
            title={markDoneHint(repoState)}
            onClick={() => setConfirm('done')}
          >
            Mark done
          </Button>
          {repoState === 'failed' && onRetryRepo && (
            <Button variant="outlined" onClick={onRetryRepo}>
              Retry GitHub
            </Button>
          )}
        </>
      )}
      {finished && (
        <Button variant="outlined" startIcon={<RotateCcw size={16} strokeWidth={1.5} />} onClick={() => setConfirm('reopen')}>
          Reopen
        </Button>
      )}

      <LabReportDialog report={report} onClose={() => setReport(null)} />

      <Dialog open={confirm === 'done'} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>Mark this capstone done?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            <strong>{row.traineeEmail}</strong> — {c?.capstone} (trainee #{c?.traineeNo}).
          </Typography>
          <Typography variant="body2" gutterBottom>
            The report is built from what this page shows now: the latest grade, the checks, the work in their repository and the lab's history.
            It is kept as it is, so it does not change when the lab is removed or old results are cleaned up.
          </Typography>
          <Typography variant="body2" gutterBottom>
            It moves to the Archive
            {c?.archiveRetentionDays ? ` and is deleted ${formatRetention(c.archiveRetentionDays)} after today` : ''}. You can delete it earlier from the Archive, or reopen it.
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Nothing is stopped or deleted now. Their lab and repository stay as they are.
          </Typography>
          {error && (
            <Box mt={1.5}>
              <Alert severity="error">Not marked done: {error}</Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={markDone} disabled={busy} color="primary" variant="contained">
            {busy ? 'Saving…' : 'Mark done and keep the report'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirm === 'reopen'} onClose={close} maxWidth="sm" fullWidth>
        <DialogTitle>Reopen this capstone?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" gutterBottom>
            It leaves the Archive and goes back to the Active list. The report that was kept when it was marked done is discarded; you can mark it done again to keep a new one.
          </Typography>
          {error && (
            <Box mt={1.5}>
              <Alert severity="error">Not reopened: {error}</Alert>
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={reopen} disabled={busy} variant="contained" color="primary">
            {busy ? 'Reopening…' : 'Reopen'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
